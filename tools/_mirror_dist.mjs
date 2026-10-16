// 把核心库 dist（权威源）镜像到全部运行时副本：md5 比对 + **删陈旧 chunk**
//
// 为什么需要它：
//   ① tsup 产物是 hash 命名的 chunk，重建后旧文件会留在副本里（实测"不删 dist 直接 tsup"= 52→87 个文件，
//      check-versions 的 A 段当场判红）；
//   ② 副本不止一处：插件 vendor、上游 integrations、全局 npm、三个 profile、以及 .pnpm 里那份
//      （DSH 真正加载的）。漏一处，用户看到的和源码就不是同一份。
//
// 用法：node tools/_mirror_dist.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const HOME = process.env.USERPROFILE || process.env.HOME;
const ROOT = "D:/dsh插件  记忆";
const SRC = path.join(ROOT, "core/SessionRelay/dist");
const DRY = process.argv.includes("--dry");
const md5 = (p) => { try { return createHash("md5").update(fs.readFileSync(p)).digest("hex"); } catch { return null; } };

const targets = [
  ["插件 vendor（作者副本）", path.join(ROOT, "plugins/dsh/vendor/dist")],
  ["上游 integrations", path.join(ROOT, "core/SessionRelay/integrations/dsh/vendor/dist")],
  ["全局 npm 安装", path.join(HOME, "AppData/Roaming/npm/node_modules/@ewanjasper/sessionrelay/dist")],
];
for (const prof of ["web", "desktop", "headless"]) {
  targets.push(["部署 " + prof + " profile", path.join(HOME, ".dsh/profiles/" + prof + "/local-plugins/dsh-srelay-brief/vendor/dist")]);
}
const pdir = path.join(HOME, ".dsh/profiles");
if (fs.existsSync(pdir)) {
  for (const prof of fs.readdirSync(pdir)) {
    const base = path.join(pdir, prof, "node_modules/.pnpm");
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base)) {
      const cand = path.join(base, d, "node_modules/dsh-srelay-brief/vendor/dist");
      if (fs.existsSync(cand)) targets.push([".pnpm " + prof, cand]);
    }
  }
}

const srcFiles = fs.readdirSync(SRC).filter((f) => f.endsWith(".js"));
console.log("权威源 " + SRC + "\n  " + srcFiles.length + " 个 .js\n");
let bad = 0;
for (const [label, dir] of targets) {
  if (!fs.existsSync(dir)) { console.log("  ⚪ " + label + "：不存在（跳过）\n     " + dir); continue; }
  let copied = 0, deleted = 0, same = 0;
  for (const f of srcFiles) {
    const t = path.join(dir, f);
    if (md5(t) === md5(path.join(SRC, f))) { same++; continue; }
    if (!DRY) fs.copyFileSync(path.join(SRC, f), t);
    copied++;
  }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    if (srcFiles.includes(f)) continue;
    if (!DRY) fs.unlinkSync(path.join(dir, f));
    deleted++;
  }
  const okNow = srcFiles.every((f) => md5(path.join(dir, f)) === md5(path.join(SRC, f)));
  // 只有"镜像完还不一致"才算问题；**删掉陈旧文件是本工具的职责**，不是残留。
  // （原实现写成 `if (!okNow || deleted) bad++`，于是正常清理也会报"仍有差异"——
  //   一条会误报的守卫比没有守卫更糟：人会学会不看它。2026-10-15 夜自测时当场踩到。）
  if (!okNow) bad++;
  console.log("  " + (okNow ? "✅" : "🔴") + " " + label + "：一致 " + same + " / 复制 " + copied + " / 删陈旧 " + deleted + (DRY ? "（dry-run）" : ""));
}
console.log(bad ? "\n" + bad + " 个目标仍有差异" : "\n全部一致");
