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
import { execFileSync } from "node:child_process";
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
    const superseded = arts.filter((f) => f !== path.basename(out)).map((f) => "ses-offline 旧包 `" + f + "`（已被取代，可删）");
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
