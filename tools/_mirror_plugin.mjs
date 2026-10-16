// 把作者副本的插件源码同步到其余 4 份拷贝（作者副本 = 权威源）
//
// 为什么不是"逐个文件硬编码"：那样每加一个源文件都要回来改这里一次，漏一次就会出现
// "作者副本对、部署副本旧"的静默分叉（check-versions 的 E 段会抓到，但那时已经晚了一步）。
// 改成走目录：排除 vendor / node_modules / .git（体积大且是生成物），其余逐文件比对 md5。
//
// 用法：node tools/_mirror_plugin.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const HOME = process.env.USERPROFILE || process.env.HOME;
const SRC = "D:/dsh插件  记忆/plugins/dsh";
const DRY = process.argv.includes("--dry");
const SKIP = new Set(["vendor", "node_modules", ".git", ".vendor-tmp"]);
const md5 = (p) => { try { return createHash("md5").update(fs.readFileSync(p)).digest("hex"); } catch { return null; } };

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const r = rel ? rel + "/" + e.name : e.name;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, r, out); else out.push(r);
  }
  return out;
}

const targets = [
  ["上游 integrations", "D:/dsh插件  记忆/core/SessionRelay/integrations/dsh"],
];
const pnpmOf = (prof) => {
  const nm = path.join(HOME, ".dsh/profiles", prof, "node_modules/.pnpm");
  try { const d = fs.readdirSync(nm).find((x) => x.startsWith("dsh-srelay-brief@")); return d ? path.join(nm, d, "node_modules/dsh-srelay-brief") : null; } catch { return null; }
};
for (const prof of ["web", "desktop", "headless"]) {
  targets.push(["部署 " + prof + " profile", path.join(HOME, ".dsh/profiles", prof, "local-plugins/dsh-srelay-brief")]);
  const pn = pnpmOf(prof);
  if (pn) targets.push([".pnpm " + prof, pn]);
}

const files = walk(SRC, "", []).sort();
console.log("权威源 " + SRC + "\n  " + files.length + " 个文件（已排除 vendor / node_modules）\n");
let problems = 0;
for (const [label, dir] of targets) {
  if (!fs.existsSync(dir)) { console.log("  ⚪ " + label + "：不存在（跳过）"); continue; }
  let copied = 0, missing = 0;
  for (const rel of files) {
    const s = path.join(SRC, rel), t = path.join(dir, rel);
    if (md5(t) === md5(s)) continue;
    if (!fs.existsSync(t)) missing++;
    if (!DRY) { fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(s, t); }
    copied++;
  }
  const extra = walk(dir, "", []).filter((f) => !files.includes(f) && !f.startsWith("vendor/") && f !== "package-lock.json" && f !== "pnpm-lock.yaml");
  if (extra.length) problems++;
  console.log("  " + (copied === 0 && !extra.length ? "✅" : "📝") + " " + label + "：复制 " + copied + (missing ? "（其中新文件 " + missing + "）" : "") + (extra.length ? " · ⚠️ 副本多 " + extra.length + " 个文件（不自动删）：" + extra.slice(0, 5).join(", ") : "") + (DRY ? "（dry-run）" : ""));
}
console.log(problems ? "\n⚠️ " + problems + " 个副本有多余文件——跑 check-versions 的 E 段核对" : "\n全部一致");
