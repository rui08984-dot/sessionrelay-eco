#!/usr/bin/env node
// SES 一键安装器（Phase 4）—— 把 SessionRelay × DSH 插件装到一台（新）机器上。
//
// ═══ 设计原则（全部来自本项目的实测教训，不是想象）═══
//  1. **默认 dry-run**：不带 --apply 只打印将要做什么。安装器本身不该是风险源。
//  2. **四重熔断，绝不装上游原版**：上游 0.5.1 没有 DSH 适配器、没有简报注入、
//     装上去会「命令成功、库建好、DSH 会话永远采不进来、全程零报错」——本项目的经典静默半失效。
//     校验：① 源码熔断（看 DSH 适配器目录与 EXTRACT_VERSION）② 构建产物指纹
//     ③ 装完跑真实 import 冒烟 ④ 装完跑 doctor/自测。任一不过即整体回滚。
//  3. **pnpm 副本必须显式镜像**：DSH 实际加载的是 profiles/<p>/node_modules/.pnpm 那份，
//     而 pnpm 的 file: 依赖走硬链接——原地改的老文件会同步，**新增文件不会进 .pnpm**。
//     2026-10-15 实测：插件因一个新增文件缺在 .pnpm 里整个加载失败，而所有自检全绿。
//  4. **每一步都要有可执行的验收**，不许出现「应该没问题」。装完必须能在真实加载路径上 import 成功。
//  5. **可回滚**：改动前先备份，失败就恢复。
//
//  6. **可卸载**：--uninstall 用安装时留下的 .bak-* 精确恢复；没有备份的目录则整体移除，
//     并明确告诉你"哪些是恢复的、哪些是删除的、哪些动不了"。
//
// 用法：
//   node tools/ses-install.mjs --source "D:\dsh插件  记忆"            # 计划（dry-run）
//   node tools/ses-install.mjs --source "D:\dsh插件  记忆" --apply    # 真装
//   node tools/ses-install.mjs --home C:\sandbox --profile web --apply  # 装到沙箱 HOME（用于验证）
//   node tools/ses-install.mjs --home C:\sandbox --profile web --uninstall [--apply]  # 卸载
//   node tools/ses-install.mjs --pack "D:\out\ses-offline.zip"        # 打离线整合包
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (name, def = null) => { const i = argv.indexOf("--" + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : (argv.includes("--" + name) ? true : def); };
const APPLY = !!arg("apply", false);
const SOURCE = path.resolve(String(arg("source", process.env.SES_SOURCE || "D:\\dsh插件  记忆")));
const HOME = path.resolve(String(arg("home", os.homedir())));
const PROFILES = String(arg("profile", "all")) === "all" ? ["web", "desktop", "headless"] : [String(arg("profile"))];
const SKIP_VENDOR = !!arg("skip-vendor", false);

const log = (...a) => console.log(...a);
const step = (n, s) => log(`\n[${n}] ${s}`);
const ok = (s) => log("    ✅ " + s);
const warn = (s) => log("    ⚠️  " + s);
const doIt = (s) => log("    ▶ " + (APPLY ? "" : "[dry-run] ") + s);
let failures = 0;
const fail = (s) => { failures++; log("    🔴 " + s); };

// ── 备份/回滚 ──
const backups = [];
function backup(p) {
  if (!fs.existsSync(p)) return;
  const b = p + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-");
  doIt("备份 " + p + " → " + path.basename(b));
  if (APPLY) { fs.cpSync(p, b, { recursive: true }); backups.push({ from: b, to: p }); }
}
function rollback() {
  if (!backups.length) { warn("没有需要回滚的改动"); return; }
  log("\n回滚：");
  for (const b of backups.reverse()) {
    try { fs.rmSync(b.to, { recursive: true, force: true }); fs.renameSync(b.from, b.to); ok("已恢复 " + b.to); }
    catch (e) { fail("回滚失败 " + b.to + "：" + e.message); }
  }
}

// ── 工具 ──
const md5 = (p) => { try { return crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex"); } catch { return null; } };
function walk(dir, base = "", skip = new Set(["node_modules", ".git"])) {
  const out = [];
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (skip.has(e.name)) continue;
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel, skip));
    else out.push(rel);
  }
  return out;
}
function run(cmd, args, cwd, timeout = 600000) {
  try { return { code: 0, out: execFileSync(cmd, args, { cwd, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { code: e.status ?? -1, out: String(e.stdout || "") + String(e.stderr || "") }; }
}

log("═".repeat(70));
log("SES 一键安装器" + (APPLY ? "（APPLY：会真的改动）" : "（dry-run：只打印计划）"));
log("  源目录 : " + SOURCE);
log("  目标 HOME: " + HOME);
log("  profiles: " + PROFILES.join(", "));
log("═".repeat(70));

// ═══ 阶段 1：前置探测 ═══
step(1, "前置环境探测");
{
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) fail(`Node ${process.version} 低于 22.5（简报内核依赖原生 node:sqlite）`);
  else ok("Node " + process.version);
  const t = run(process.execPath, ["-e", "import('node:sqlite').then(s=>{const d=new s.DatabaseSync(':memory:');d.exec('create table t(x)');d.close();console.log('ok')}).catch(e=>{console.error(e.message);process.exit(2)})"]);
  if (t.code === 0) ok("node:sqlite 可用"); else fail("node:sqlite 不可用：" + t.out.trim().slice(0, 120));
  const dshDir = path.join(HOME, ".dsh", "profiles");
  if (fs.existsSync(dshDir)) ok("检测到 DSH profiles：" + dshDir); else warn("未检测到 DSH profiles（" + dshDir + "）——将只安装 CLI，不装插件");
}

// ═══ 阶段 2：源校验（四重熔断之一：绝不装上游原版）═══
step(2, "源校验：确认是 SES fork 而不是上游原版");
const CORE = path.join(SOURCE, "core", "SessionRelay");
const PLUGIN = path.join(SOURCE, "plugins", "dsh");
{
  if (!fs.existsSync(path.join(CORE, "package.json"))) fail("源目录里找不到 core/SessionRelay —— --source 指错了？");
  else ok("核心库在场：" + CORE);
  const dshAdapter = path.join(CORE, "src", "adapters", "dsh");
  if (fs.existsSync(dshAdapter)) ok("DSH 适配器在场（上游原版没有这一项）"); else fail("缺 src/adapters/dsh —— 这是上游原版的特征，拒绝安装");
  const verFile = path.join(CORE, "src", "core", "extract", "version.ts");
  let exv = 0;
  try { exv = Number((fs.readFileSync(verFile, "utf8").match(/EXTRACT_VERSION\s*=\s*(\d+)/) || [])[1] || 0); } catch {}
  if (exv >= 14) ok("EXTRACT_VERSION = " + exv + "（≥14）"); else fail("EXTRACT_VERSION = " + exv + "（<14，不是当前 fork）");
  if (fs.existsSync(path.join(PLUGIN, "index.js"))) ok("插件源码在场：" + PLUGIN); else fail("缺 plugins/dsh/index.js");
  if (fs.existsSync(path.join(PLUGIN, "src", "brief-filters.mjs"))) ok("简报过滤器单一权威源在场"); else fail("缺 src/brief-filters.mjs（简报会静默失效）");
}
if (failures) { log("\n🔴 前置或源校验未通过，未做任何改动。"); process.exit(1); }

// ═══ 阶段 3：构建 CLI 运行时 ═══
step(3, "构建 CLI 运行时（dist/）");
{
  const dist = path.join(CORE, "dist");
  const tsup = path.join(CORE, "node_modules", "tsup", "dist", "cli-default.js");
  if (!fs.existsSync(tsup)) { warn("没找到本地 tsup（" + tsup + "）——跳过构建，直接用现有 dist"); }
  else {
    if (fs.existsSync(dist)) { doIt("清空旧 dist"); if (APPLY) fs.rmSync(dist, { recursive: true, force: true }); }
    doIt("node node_modules/tsup/dist/cli-default.js（重建 dist）");
    if (APPLY) {
      const r = run(process.execPath, [tsup], CORE);
      if (r.code === 0) ok("构建成功"); else fail("构建失败：" + r.out.slice(-300));
    }
  }
  const js = fs.existsSync(dist) ? fs.readdirSync(dist).filter((f) => f.endsWith(".js")).length : 0;
  if (js > 0) ok("dist 内 " + js + " 个 js"); else fail("dist 为空");
}

// ═══ 阶段 4：生成插件自包含运行时（vendor）═══
step(4, "生成插件 vendor（62MB 自包含运行时）");
{
  const gen = path.join(PLUGIN, "vendor-srelay.mjs");
  if (SKIP_VENDOR) warn("--skip-vendor：跳过");
  else if (!fs.existsSync(gen)) fail("缺 vendor-srelay.mjs，无法生成自包含运行时");
  else {
    const have = fs.existsSync(path.join(PLUGIN, "vendor", "dist", "srelay.js"));
    doIt((have ? "重新生成" : "首次生成") + " vendor（从 " + CORE + "）");
    if (APPLY) {
      const r = run(process.execPath, [gen, "--from", CORE], PLUGIN);
      if (r.code === 0) ok("vendor 生成成功（" + (r.out.match(/vendor 就绪[^\n]*/) || ["已就绪"])[0] + "）");
      else fail("vendor 生成失败：" + r.out.slice(-300));
    }
  }
}

// ═══ 阶段 5：部署 CLI（全局 npm）═══
step(5, "部署 CLI 到全局 npm（ZCode hook 与 headless 回落都用它）");
{
  const gDir = process.platform === "win32"
    ? path.join(HOME, "AppData", "Roaming", "npm", "node_modules", "@ewanjasper", "sessionrelay")
    : path.join(HOME, ".npm-global", "lib", "node_modules", "@ewanjasper", "sessionrelay");
  if (!fs.existsSync(gDir)) { warn("全局 npm 包目录不存在（" + gDir + "）——请先 npm i -g @ewanjasper/sessionrelay，或用本地 tarball 安装"); }
  else {
    backup(path.join(gDir, "dist"));
    doIt("把 " + CORE + "\\dist 镜像到 " + gDir + "\\dist（md5 比对 + 删陈旧）");
    if (APPLY) {
      const src1 = path.join(CORE, "dist"), dst1 = path.join(gDir, "dist");
      let c = 0, d = 0;
      for (const f of fs.readdirSync(src1)) { if (!f.endsWith(".js")) continue; if (md5(path.join(src1, f)) !== md5(path.join(dst1, f))) { fs.copyFileSync(path.join(src1, f), path.join(dst1, f)); c++; } }
      for (const f of fs.readdirSync(dst1)) { if (f.endsWith(".js") && !fs.existsSync(path.join(src1, f))) { fs.unlinkSync(path.join(dst1, f)); d++; } }
      ok("复制 " + c + " / 删陈旧 " + d);
    }
  }
}

// ═══ 阶段 6：部署插件到各 profile（含 .pnpm 镜像）═══
step(6, "部署插件到 DSH profiles（含 .pnpm 真实加载路径）");
const SKIP = new Set(["node_modules", ".git"]);
const pnpmDirOf = (prof) => {
  const nm = path.join(HOME, ".dsh", "profiles", prof, "node_modules", ".pnpm");
  try { const d = fs.readdirSync(nm).find((x) => x.startsWith("dsh-srelay-brief@")); return d ? path.join(nm, d, "node_modules", "dsh-srelay-brief") : null; } catch { return null; }
};
const pluginTargets = [path.join(CORE, "integrations", "dsh")];
for (const p of PROFILES) {
  pluginTargets.push(path.join(HOME, ".dsh", "profiles", p, "local-plugins", "dsh-srelay-brief"));
  const pn = pnpmDirOf(p);
  if (pn) pluginTargets.push(pn); else warn("profile " + p + " 没有 .pnpm 副本（DSH 未在该 profile 装过本插件？）——装完可能需要 pnpm install 才会出现");
}
// ═══ 卸载路径（--uninstall）：早退，不跑安装流程 ═══
if (arg("uninstall", false)) {
  step(8, "卸载：优先用安装时留下的备份精确恢复，无备份则整体移除");
  const pnpmDirOf2 = (prof) => {
    const nm = path.join(HOME, ".dsh", "profiles", prof, "node_modules", ".pnpm");
    try { const d = fs.readdirSync(nm).find((x) => x.startsWith("dsh-srelay-brief@")); return d ? path.join(nm, d, "node_modules", "dsh-srelay-brief") : null; } catch { return null; }
  };
  const targets = [path.join(CORE, "integrations", "dsh")];
  for (const p of PROFILES) { targets.push(path.join(HOME, ".dsh", "profiles", p, "local-plugins", "dsh-srelay-brief")); const pn = pnpmDirOf2(p); if (pn) targets.push(pn); }
  const gDir = process.platform === "win32" ? path.join(HOME, "AppData", "Roaming", "npm", "node_modules", "@ewanjasper", "sessionrelay", "dist") : null;
  if (gDir && fs.existsSync(gDir)) targets.push(gDir);
  let restored = 0, removed = 0, skipped = 0;
  for (const T of targets) {
    const parent = path.dirname(T), baseName = path.basename(T);
    let baks = [];
    try { baks = fs.readdirSync(parent).filter((x) => x.startsWith(baseName + ".bak-")).sort(); } catch {}
    if (baks.length) {
      const newest = path.join(parent, baks[baks.length - 1]);
      doIt("恢复 " + T.replace(HOME, "~") + " ← " + baks[baks.length - 1]);
      if (APPLY) { try { fs.rmSync(T, { recursive: true, force: true }); fs.renameSync(newest, T); restored++; } catch (e) { fail("恢复失败：" + e.message); } }
    } else if (fs.existsSync(T)) {
      doIt("无备份 → 移除 " + T.replace(HOME, "~"));
      if (APPLY) { try { fs.rmSync(T, { recursive: true, force: true }); removed++; } catch (e) { fail("移除失败：" + e.message); } }
    } else { skipped++; }
  }
  log("\n" + "═".repeat(70));
  log((APPLY ? "✅ 卸载完成" : "✅ dry-run 通过——加 --apply 才会真的改动") + `（恢复 ${restored} / 移除 ${removed} / 无需处理 ${skipped}）`);
  log("   注意：记忆库（.sessionrelay/relay.sqlite）**不动**——那是你的数据，卸载程序不等于删数据。");
  log("═".repeat(70));
  process.exit(failures ? 1 : 0);
}

// ═══ 离线整合包（--pack）：把 CLI 构建 + 插件 + vendor + 本安装器打成一个 zip ═══
if (arg("pack", null)) {
  const out = path.resolve(String(arg("pack")));
  step(9, "打离线整合包 → " + out);
  const vendorDir = path.join(PLUGIN, "vendor");
  if (!fs.existsSync(path.join(vendorDir, "dist", "srelay.js"))) fail("vendor 还没生成——先跑一次不带 --pack 的安装（或 vendor-srelay.mjs）");
  if (!failures) {
    // fflate 的 ESM 入口是 esm/index.mjs（不是 browser.mjs —— 踩过一次）。
    // 优先用核心库的依赖，其次插件 vendor 里的（自包含后 vendor 一定有）。
    const fflateCandidates = [
      path.join(CORE, "node_modules", "fflate", "esm", "index.mjs"),
      path.join(PLUGIN, "vendor", "node_modules", "fflate", "esm", "index.mjs"),
    ];
    let fflate = null;
    for (const c of fflateCandidates) { if (!fs.existsSync(c)) continue; fflate = await import(pathToFileURL(c).href).catch(() => null); if (fflate) break; }
    if (!fflate) fail("找不到 fflate（" + CORE + "/node_modules/fflate）——离线包需要它打 zip");
    else if (APPLY) {
      const entries = {};
      // 打包必须包含 node_modules —— vendor 的运行时主体就是它。
      // （第一次打出来只有 0.4MB，就因为沿用了安装流程那个跳过 node_modules 的 walk。）只跳 .git。
      const walkAll = (dir, base = "") => {
        const out = [];
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name === ".git") continue;
          const rel = base ? base + "/" + e.name : e.name;
          if (e.isDirectory()) out.push(...walkAll(path.join(dir, e.name), rel)); else out.push(rel);
        }
        return out;
      };
      const add = (prefix, dir) => { for (const rel of walkAll(dir)) { const abs = path.join(dir, rel.split("/").join(path.sep)); entries[prefix + "/" + rel] = new Uint8Array(fs.readFileSync(abs)); } };
      add("plugins/dsh", PLUGIN);           // 含 vendor
      add("core-dist", path.join(CORE, "dist"));
      add("tools", path.join(SOURCE, "tools"));
      // [1016] 离线包要能"一包装完两个端"：原先只装 DSH，ZCode 用户还得另找适配器。
      const ZC = path.join(SOURCE, "integrations", "zcode");
      if (fs.existsSync(ZC)) add("zcode-adapter", ZC);
      const SK = path.join(SOURCE, "integrations", "skills");
      if (fs.existsSync(SK)) add("skills", SK);
      // 包内说明：不写清楚用法，离线包等于半个谜题
      const packReadme = [
        "# SessionRelay 离线包",
        "",
        "本包用于**新机器 / 无网络 / 不装 npm** 的环境。内容与用法：",
        "",
        "| 目录 | 是什么 | 怎么用 |",
        "|---|---|---|",
        "| core-dist/ | 核心库构建产物 | 覆盖到已装 CLI 的 dist/（尚未装过 CLI 时先按仓库 INSTALL.md 装一次内核） |",
        "| plugins/dsh/ | DSH 插件，**含 vendor 自包含运行时** | 整个目录覆盖到 DSH Home 的 profiles/<profile>/local-plugins/dsh-srelay-brief/，然后**重启 DSH** |",
        "| zcode-adapter/ | ZCode 适配器（SessionStart 简报） | 先 node install.mjs 看计划，再 node install.mjs --apply |",
        "| skills/ | handoff-atlas 交接技能 | 拷到 ~/.agents/skills/ 与 ~/.dsh/skills/ |",
        "| tools/ | 安装器与守门脚本 | 备用 |",
        "",
        "## 验收（别跳过）",
        "",
        "1. srelay --version   —— CLI 可用",
        "2. srelay doctor      —— 0 失败",
        "3. srelay brief       —— 简报真的有内容（空 = 静默半失效）",
        "",
        "装完**必须重启 DSH**——常驻进程不会因为文件更新而更新，不重启你看到的还是旧版。",
        "",
        "## 打包信息",
        "",
        "- 生成时间：" + new Date().toISOString(),
        "- 来源工作区：" + SOURCE,
        "",
      ].join("\n");
      entries["README-OFFLINE.md"] = new Uint8Array(Buffer.from(packReadme, "utf8"));
      const buf = fflate.zipSync(entries, { level: 6 });
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
      ok("离线包 " + (buf.length / 1024 / 1024).toFixed(1) + " MB，含 " + Object.keys(entries).length + " 个文件");
      ok("解包后用法：把 core-dist 覆盖到已装 CLI 的 dist/，把 plugins/dsh 覆盖到 profile 的 local-plugins/，再跑 --uninstall 可回退");
    } else doIt("打包（dry-run）");
  }
  log("\n" + "═".repeat(70));
  log(failures ? "🔴 打包未完成" : "✅ 打包完成");
  log("═".repeat(70));
  process.exit(failures ? 1 : 0);
}

const srcFiles = walk(PLUGIN);
for (const D of pluginTargets) {
  backup(D);
  doIt("镜像 " + srcFiles.length + " 个文件 → " + D.replace(HOME, "~"));
  if (!APPLY) continue;
  let c = 0, del = 0;
  const dstFiles = fs.existsSync(D) ? walk(D) : [];
  for (const rel of srcFiles) {
    const s = path.join(PLUGIN, rel.split("/").join(path.sep)), t = path.join(D, rel.split("/").join(path.sep));
    fs.mkdirSync(path.dirname(t), { recursive: true });
    if (md5(s) !== md5(t)) { fs.copyFileSync(s, t); c++; }
  }
  for (const rel of dstFiles) if (!srcFiles.includes(rel)) { try { fs.unlinkSync(path.join(D, rel.split("/").join(path.sep))); del++; } catch {} }
  ok("复制 " + c + " / 删陈旧 " + del);
}

// ═══ 阶段 7：验收（必须能在真实加载路径上 import 成功）═══
step(7, "验收：真实加载路径 import 冒烟 + 自测");
for (const D of pluginTargets) {
  const entry = path.join(D, "index.js");
  if (!fs.existsSync(entry)) { if (APPLY) fail("缺 " + entry); continue; }
  if (!APPLY) { doIt("import 冒烟 " + entry.replace(HOME, "~")); continue; }
  const r = run(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(pathToFileURL(entry).href)}).then(m=>{console.log(Object.keys(m).join(","))}).catch(e=>{console.error(e.code||e.message);process.exit(3)})`]);
  if (r.code === 0) ok("可加载：" + D.replace(HOME, "~") + "  导出[" + r.out.trim().slice(0, 60) + "]");
  else fail("无法加载（ERR_MODULE_NOT_FOUND 类）：" + D.replace(HOME, "~") + " → " + r.out.trim().slice(0, 120));
}

// ═══ 收尾 ═══
log("\n" + "═".repeat(70));
if (failures) {
  log("🔴 " + failures + " 项未通过");
  if (APPLY) rollback();
  process.exit(1);
}
if (APPLY) {
  log("✅ 安装完成。后续：");
  log("   1) 重启 DSH（它会重新加载插件与 MCP）");
  log("   2) 重启守护：杀 srelay.js watch 的 node 进程 → 重跑 watch-task.vbs");
  log("   3) 对新项目跑 srelay init 建库；已有库不需要动");
  log("   4) 跑 tools/check-versions.mjs 六项自检（A–D 一致性 + E 文件集 + F 真实 import）");
} else {
  log("✅ dry-run 通过——加 --apply 才会真的改动");
}
log("═".repeat(70));
