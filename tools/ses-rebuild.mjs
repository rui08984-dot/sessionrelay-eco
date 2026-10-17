// 全链路重建：源码 → dist → 8 个运行时副本 → 守门 → （可选）离线包
//
// 为什么需要它：改一次核心库要手工做 6 件事（干净重建、镜像 dist、镜像插件、跑三个守门、
// 视情况重打离线包），少做一件就出现「源码是新的、用户看到的还是旧的」那类静默分叉。
// 一条命令做完，并把结果压成一屏。
//
// 用法：
//   node tools/ses-rebuild.mjs            # 重建 + 镜像 + 守门
//   node tools/ses-rebuild.mjs --pack     # 上面全部，再重打离线整合包到 artifacts/
//   node tools/ses-rebuild.mjs --no-guard # 只重建与镜像（赶时间时用，别常用）
//
// ⚠️ 重建前**必须删 dist**：直接跑 tsup 会留下上一轮的 hash 命名 chunk（实测 52 → 87 个文件）。
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;
const CORE = path.join(HERE, "core", "SessionRelay");
const args = process.argv.slice(2);
const PACK = args.includes("--pack");
const NOGUARD = args.includes("--no-guard");
const t0 = Date.now();
const step = (n, t) => console.log("\n[" + n + "] " + t);
const run = (file, argv, cwd) => {
  try { return { code: 0, out: execFileSync(file, argv, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) }; }
  catch (e) { return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
};
const fail = [];

step(1, "干净重建核心库 dist");
fs.rmSync(path.join(CORE, "dist"), { recursive: true, force: true });
{
  const r = run(NODE, [path.join(CORE, "node_modules/tsup/dist/cli-default.js")], CORE);
  const n = fs.readdirSync(path.join(CORE, "dist")).filter((f) => f.endsWith(".js")).length;
  console.log("  " + (r.code === 0 ? "✅" : "🔴") + " tsup 退出 " + r.code + "，dist 内 " + n + " 个 js");
  if (r.code !== 0) { console.log(r.out.slice(-800)); fail.push("构建"); }
}

step(2, "镜像 dist 到全部运行时副本（含 .pnpm）");
{
  const r = run(NODE, [path.join(HERE, "tools", "_mirror_dist.mjs")], HERE);
  console.log(r.out.trimEnd());
  if (r.out.includes("个目标仍有差异")) fail.push("dist 镜像");
}

step(3, "镜像插件源码到其余副本（含 .pnpm 硬链接那份）");

// ── 部署后的进程换新（1017 夜补）────────────────────────────────────────────
// 病历：重建把磁盘代码换了新，但**已经在跑的守护还握着旧代码** —— check-versions C 段
// 反复报"pid X 启动早于最新构建，跑的是旧代码"，而换新原先靠一个外挂脚本的守护阶段来做，
// 那个脚本已按 ADR-002 退役。原则很简单：**谁把代码变新，谁负责让进程换新**，
// 所以这一步属于构建管线（而不是又一个巡检脚本）。启动命令只在这里写一份。
function restartWatchDaemon() {
  try {
    const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*srelay.js*watch*' -and $_.CommandLine -like '*--global*' } | ForEach-Object { $_.ProcessId.ToString() }";
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const pids = out.trim().split(/\r?\n/).filter(Boolean).map((x) => Number(x.trim())).filter(Number.isFinite);
    // ⚠️ 2026-10-17 实测两处"采集停摆"：① 没有旧进程时这里直接 return（守护就一直没起来）；
    //    ② "杀旧→立刻起新"之间不等管道释放 ⇒ 新实例抢不到全局管道锁就自己退出，一个都不剩。
    //    所以现在：不管有没有旧进程都要**保证换完之后有一个在跑**，并验证活着。
    if (!pids.length) console.log("       守护原本没在跑 —— 直接拉起（以前这里是'跳过换新'，于是采集停摆没人管）");
    for (const p of pids) { try { process.kill(p); } catch { /* 已退出 */ } }
    // 等内核管道对象随进程消失（不等这一下，新实例会 acquirePipeLockByName 失败后静默退出）
    if (pids.length) { const t0 = Date.now(); while (Date.now() - t0 < 4000 && watchGlobalPids().length) { busyWait(150); } }
    const logDir = path.join(HERE, '.sessionrelay', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const fd = fs.openSync(path.join(logDir, 'watch.log'), 'a');
    const child = spawn(process.execPath, [path.join(HERE, 'core', 'SessionRelay', 'dist', 'srelay.js'), 'watch', '--global'],
      { cwd: HERE, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
    child.unref();
    fs.closeSync(fd);
    // 验证真的活着；不行就重试 —— 拉不起来必须**吼出来**（并让汇总判失败）
    let alive = false;
    for (let attempt = 1; attempt <= 3 && !alive; attempt++) {
      const t1 = Date.now(); while (Date.now() - t1 < 2500 && !watchGlobalPids().length) busyWait(150);
      alive = watchGlobalPids().length > 0;
      if (!alive) { try { process.kill(child.pid); } catch { /* 已退出 */ } }
    }
    if (alive) console.log("       守护已换新（旧 " + (pids.join(',') || '无') + " → 新 pid " + child.pid + "，已确认存活）");
    else { console.log("       🔴 守护拉不起来（连试 3 次）—— 采集会停摆，看 .sessionrelay/logs/watch-global.log"); return false; }
    return true;
  } catch (e) { console.log("       ⚠️ 换新失败：" + String(e && e.message).slice(0, 70)); return false; }
}

/** 列出**全局**守护 pid（只看 --global：项目级 --foreground 是别的东西，别误杀） */
function watchGlobalPids() {
  // ── [1021] 改用**项目锁**判活，PowerShell 只作补充 ──
  //
  // 病历：这里原来只靠 `Get-CimInstance ... -like '*srelay.js*watch --global*'`。
  //   同一个假阴性本轮出现了**两次**：守护锁心跳 3 秒、watch.log 还在滚，
  //   但命令行匹配不到（引号/npx 包装/执行策略都可能变）⇒ 判成「一个都没起」⇒
  //   构建管线连试 3 次全失败，报「守护拉不起来，采集会停摆」。
  //   而实际上守护好好的。
  //
  // 现在：先读锁（守护自己写的，唯一权威），读不到再用进程表兜底。
  const locked = [];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(HERE, '.sessionrelay', 'lock'), 'utf8'))
    const age = Date.now() - Number(j.heartbeat)
    let up = false
    try { process.kill(Number(j.pid), 0); up = true } catch { up = false }
    if (up && age < 60_000) locked.push(Number(j.pid))
  } catch { /* 没锁就靠进程表 */ }
  if (locked.length) return locked
  const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*srelay.js*watch*' -and $_.CommandLine -like '*--global*' } | ForEach-Object { $_.ProcessId.ToString() }"
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    return out.trim().split(/\r?\n/).filter(Boolean).map((x) => Number(x.trim())).filter(Number.isFinite)
  } catch { return [] }
}
const busyWait = (ms) => { const t = Date.now(); while (Date.now() - t < ms) { /* 同步等：构建脚本里用 async 反而更绕 */ } };
if (!restartWatchDaemon()) fail.push('守护换新');
// 面板插件：vendor/dist 同步 + 装进 profile（含 pnpm install）。
// ⚠️ 必须排在下面 _mirror_plugin.mjs **之前**：pnpm 会用缓存快照重建 file: 依赖的 .pnpm 副本，
//    而那个副本才是 DSH 真正加载的路径 —— 让镜像步骤在它之后跑，才能把被还原的旧文件补回来。
{
  const r = run(NODE, [path.join(HERE, "tools", "ses-panel-install.mjs"), "--apply"], HERE);
  const lines = r.out.trimEnd().split(/\r?\n/).filter((l) => /[①②③④⑤⑥]|✅|🔴|作者副本/.test(l));
  console.log("  " + (r.code === 0 && !r.out.includes("🔴") ? "✅" : "🔴") + " 面板插件（ses-panel-install）");
  for (const l of lines.slice(-8)) console.log("      " + l.trim().slice(0, 150));
  if (r.code !== 0 || r.out.includes("🔴")) fail.push("面板插件安装");
}
{
  const r = run(NODE, [path.join(HERE, "tools", "_mirror_plugin.mjs")], HERE);
  console.log(r.out.trimEnd());
}

let packInfo = null;
if (PACK) {
  step(4, "重打离线整合包（--pack）");
  // 用**本地时间**命名：台账是给人看的，UTC 会让人对不上"我刚跑的是哪个"（实测踩过）。
  const d0 = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const ts = "" + d0.getFullYear() + p2(d0.getMonth() + 1) + p2(d0.getDate()) + "-" + p2(d0.getHours()) + p2(d0.getMinutes());
  const out = path.join(HERE, "artifacts", "ses-offline-" + ts + ".zip");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = run(NODE, [path.join(HERE, "tools", "ses-install.mjs"), "--apply", "--skip-vendor", "--pack", out], HERE);
  if (r.code === 0 && fs.existsSync(out)) {
    const buf = fs.readFileSync(out);
    packInfo = { path: out, mb: (buf.length / 1024 / 1024).toFixed(1), sha: createHash("sha256").update(buf).digest("hex") };
    console.log("  ✅ " + out + "  " + packInfo.mb + " MB  sha256 " + packInfo.sha.slice(0, 32));
    // 二进制不入 git（20MB×N），所以**用一份台账替代版本控制**：当前包是谁、指纹多少、怎么重建。
    // 同时把"被取代的旧包"点名列出来——留着它们不是错，但必须能一眼看出哪个是当前的。
    const arts = fs.readdirSync(path.join(HERE, "artifacts")).filter((f) => f.endsWith(".zip")).sort();
    // ⚠️ [1017 夜] 原来这里按「artifacts 下所有 .zip」算，**把当期的三个客户端包也列成「被取代」**
    //（dsh-plugin / zcode-adapter / dsh-panel 全被点名要删）。它们是**当前资产**，不是旧离线包 ——
    // 真照着删，发布步骤会直接少三个附件，而这个台账会天天骗人。改成只筛 ses-offline- 前缀。
    const superseded = arts
      .filter((f) => f.startsWith('ses-offline-') && f !== path.basename(out))
      .map((f) => 'ses-offline 旧包 ' + f + '（已被取代，可删）');
    fs.writeFileSync(path.join(HERE, "artifacts", "LATEST.md"), [
      "# 离线整合包台账（自动生成，勿手改）",
      "",
      "- **当前包**：`" + path.basename(out) + "`",
      "- 大小：" + packInfo.mb + " MB",
      "- sha256：`" + packInfo.sha + "`",
      "- 生成时间：" + new Date().toString(),
      "- 重建方式：`node tools/ses-rebuild.mjs --pack`（源码 → dist → 8 个副本 → 守门 → 本包）",
      "- 解包用法：把 `core-dist` 覆盖到已装 CLI 的 `dist/`，把 `plugins/dsh` 覆盖到 profile 的 `local-plugins/`",
      "",
      superseded.length ? "## 被取代的包\n\n" + superseded.map((s) => "- " + s).join("\n") : "（没有旧包）",
      "",
    ].join("\n"));
    console.log("  ✅ 台账已写 artifacts/LATEST.md");
    // [1015 夜 · A3] 台账**自动核对**：LATEST.md 里记的 sha256 必须与磁盘上那个包的实测值一致。
    // 为什么要核：二进制不入 git，台账就是唯一的"当前是哪个包"的凭据；
    // 台账漂了（手工编辑/半途中断）就会指向一个内容已经变了的文件，而没人会发现。
    try {
      const fsx = await import('node:fs');
      const { createHash: ch } = await import('node:crypto');
      const md = fsx.readFileSync(path.join(HERE, 'artifacts', 'LATEST.md'), 'utf8');
      const named = /当前包\*\*：`([^`]+)`/.exec(md)?.[1];
      const sha = /sha256：`([0-9a-f]{64})`/.exec(md)?.[1];
      const real = named && fsx.existsSync(path.join(HERE, 'artifacts', named))
        ? ch('sha256').update(fsx.readFileSync(path.join(HERE, 'artifacts', named))).digest('hex') : null;
      if (!named || !sha || !real) console.log('  ⚠️ 台账核对：读不到包名/sha 或文件不存在');
      else if (real !== sha) console.log('  🔴 台账核对失败：LATEST.md 记的 sha 与实测不符（台账漂了）');
      else console.log('  ✅ 台账核对：LATEST.md 记的 sha256 与磁盘实测一致');
    } catch (e) { console.log('  ⚠️ 台账核对异常：' + String(e && e.message).slice(0, 60)) }
  } else { console.log("  🔴 打包失败：" + r.out.slice(-600)); fail.push("离线包"); }
}

const guard = {};
if (!NOGUARD) {
  step(PACK ? 5 : 4, "守门");
  const guards = [
    ["check-versions", [path.join(HERE, "tools", "check-versions.mjs")]],
    ["check-brief-filters", [path.join(HERE, "tools", "check-brief-filters.mjs")]],
    // [B6] 不变量守门：同一条规则只准有一份实现（静态）+ 两条行为断言的存在性
    ["check-invariants", [path.join(HERE, "tools", "check-invariants.mjs")]],
    ["插件 selftest", [path.join(HERE, "plugins", "dsh", "selftest.mjs")]],
    // [1017 夜] 面板两块：① 依赖闭包（panel.js 只许 import node 内置）
    //                       ② 宿主半真链路自测（真 HTTP 打真数据；装了没生效在这里就现形）
    ["check-panel-deps", [path.join(HERE, "tools", "check-panel-deps.mjs")]],
    ["面板 selftest", [path.join(HERE, "integrations", "dsh-srelay-panel", "selftest.mjs")]],
    // [1021] 端到端简报一致性：同一份库、同一份原始数据，走 DSH 与 ZCode 两条渲染链逐条对拍。
    //   为什么必须进守门：现有 check-brief-filters 只对拍**过滤器**（同一个函数两边跑），
    //   抓不到「过滤器一样但取数/渲染不一样」的分叉 —— 而红队 R4 正是那个形状
    //   （CLI 决策无时间窗、DSH/ZCode 都是 48h + pin 豁免）。不进守门的检查 = 没人跑。
    //   无参运行 = 拿 cwd 的项目库（重建时 cwd 就是本仓，自带 .sessionrelay）。
    ["check-brief-e2e", [path.join(HERE, "tools", "check-brief-e2e.mjs")]],
    // [1021 审查 #18] 发布检查（MCP 工具名文档覆盖 / 旧计数 / CHANGELOG 版本 / 发布模块采集契约）。
    //   为什么必须进守门：此前工具名抽取正则与实际 register( 调用早已脱节，检查红着半年没人知道
    //   —— 我们天天说"七门全绿"，而这一门根本没在跑。进守门后红立刻变 overall 红。
    ["check-artifacts", [path.join(CORE, "scripts", "check-artifacts.mjs")]],
  ];
  for (const [name, argv] of guards) {
    const cwd = name === "插件 selftest" ? path.join(HERE, "plugins", "dsh") : HERE;
    const r = run(NODE, argv, cwd);
    const tail = r.out.trimEnd().split(/\r?\n/).filter((l) => /🔴|FAIL|全部一致|PASS|两侧简报|处问题/.test(l)).slice(-4);
    guard[name] = r.code;
    console.log("  " + (r.code === 0 ? "✅" : "🔴") + " " + name + "（退出 " + r.code + "）");
    for (const l of tail) console.log("      " + l.trim().slice(0, 150));
    if (r.code !== 0 && name !== "check-versions") fail.push(name);
  }
  console.log("  注：check-versions 的 C 段会因为「守护跑的是旧代码」判红——那是预期的；");
  console.log("      常驻进程要重启才换新代码（DSH 宿主同理，见 C2 段）。");
}

console.log("\n══════════ 汇总（" + ((Date.now() - t0) / 1000).toFixed(1) + "s）══════════");
{
  const distDir = path.join(CORE, "dist");
  const files = fs.readdirSync(distDir).filter((f) => f.endsWith(".js")).sort();
  const h = createHash("md5");
  for (const f of files) h.update(fs.readFileSync(path.join(distDir, f)));
  console.log("  dist 指纹 " + h.digest("hex").slice(0, 16) + "（" + files.length + " 个 js）");
}
if (packInfo) console.log("  离线包 " + packInfo.path + "  " + packInfo.mb + " MB  sha256 " + packInfo.sha);
if (!NOGUARD) console.log("  守门退出码 " + JSON.stringify(guard));
console.log(fail.length ? "  🔴 未过：" + fail.join(" / ") : "  ✅ 全部完成");
process.exit(fail.length ? 1 : 0);
