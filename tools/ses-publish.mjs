#!/usr/bin/env node
/**
 * ses-publish.mjs —— 把本工作区组装成一个可公开发布的**单仓库**（monorepo）。
 *
 * 为什么要这个脚本而不是手抄一遍：
 *   ① 发布树是**派生物**，必须能一条命令重现（手抄一次就再也对不上源）；
 *   ② 发布内容有**取舍**（vendor/node_modules/dist/.git 一律不进；内部交接文档不进），
 *      取舍规则写死在脚本里，比写在人脑子里可靠；
 *   ③ 组装完当场做**发布前自检**（四个包的入口文件在不在、README 里的相对路径是否真实存在）。
 *
 * 用法：
 *   node tools/ses-publish.mjs --out D:/sessionrelay-eco            # 组装（已存在非空目录会拒绝）
 *   node tools/ses-publish.mjs --out D:/sessionrelay-eco --force    # 覆盖重建
 *   node tools/ses-publish.mjs --out D:/sessionrelay-eco --git      # 组装后 git init + 首次提交
 *
 * 注意：本脚本**只做本地组装**，不建仓、不推送。发布是人的动作（见 release/PUBLISH.md）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(path.dirname(ROOT), 'sessionrelay-eco')));
const FORCE = argv.includes('--force');
const GIT = argv.includes('--git');

let fail = 0;
const say = (s) => console.log(s);
const ok = (s) => say('  ✅ ' + s);
const warn = (s) => say('  ⚠️  ' + s);
const bad = (s) => { fail++; say('  🔴 ' + s); };

// ── 组装规则 ──────────────────────────────────────────────────────────────
/** 一律不进发布树的目录/文件（名字匹配即跳过） */
const SKIP_NAMES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.sessionrelay', '.pnpm', 'backups', '.tsbuildinfo']);
/** 相对路径片段匹配即跳过（vendor 是大头：核心库 integration vendor 61MB / 插件 vendor 61MB） */
const SKIP_FRAGMENTS = [
  '/vendor/', '/node_modules/', '/.git/',
  // 测试临时产物（会带本机路径进文件名）+ 自动接入的临时目录
  '/test/.tmp/', '/.tmp/', '/srelay-autoinit-',
  // 核心库里那份 DSH 集成是插件的历史镜像副本；对外只发 packages/dsh-plugin 一份，避免两个"插件"打架
  '/integrations/dsh/',
];
const SKIP_FILE_RE = /(\.log$|\.tgz$|\.zip$|\.sqlite(-wal|-shm)?$|\.bak-)/;

function copyTree(src, dst, stats) {
  if (!fs.existsSync(src)) return;
  const walk = (s, d) => {
    const st = fs.statSync(s);
    if (st.isDirectory()) {
      if (SKIP_NAMES.has(path.basename(s))) { stats.skipped++; return; }
      fs.mkdirSync(d, { recursive: true });
      for (const e of fs.readdirSync(s)) walk(path.join(s, e), path.join(d, e));
      return;
    }
    const rel = '/' + path.relative(ROOT, s).replace(/\\/g, '/') + '/';
    if (SKIP_FRAGMENTS.some((f) => rel.includes(f)) || SKIP_FILE_RE.test(s)) { stats.skipped++; return; }
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
    stats.files++; stats.bytes += fs.statSync(d).size;
  };
  walk(src, dst);
}

// ── 0) 前置检查 ───────────────────────────────────────────────────────────
say('══ 组装发布树（monorepo） ══');
say('  源  : ' + ROOT);
say('  目标: ' + OUT);
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length && !FORCE) {
  bad('目标目录已存在且非空——加 --force 覆盖重建');
  process.exit(1);
}
const REQUIRED = [
  'core/SessionRelay/package.json',
  'plugins/dsh/package.json',
  'integrations/zcode/brief.mjs',
  'integrations/skills/handoff-atlas/SKILL.md',
  'publish/README.md',
  'publish/INSTALL.md',
];
for (const r of REQUIRED) if (!fs.existsSync(path.join(ROOT, r))) bad('源缺失: ' + r);
if (fail) { say('\n🔴 前置检查未过'); process.exit(1); }

// ── 1) 清空目标 ───────────────────────────────────────────────────────────
// 清空目标，但**保留 .git**（否则每次重组装都会丢掉提交历史与远端配置，
// 下次推送只能 force——实测踩过：一次 --force 之后仓库变成孤儿）
if (fs.existsSync(OUT)) {
  for (const e of fs.readdirSync(OUT)) {
    if (e === '.git') continue;
    fs.rmSync(path.join(OUT, e), { recursive: true, force: true });
  }
}
fs.mkdirSync(OUT, { recursive: true });

// ── 2) 四个包 + 技能 + 工具 ───────────────────────────────────────────────
const stats = { files: 0, bytes: 0, skipped: 0 };
const PLANS = [
  ['core/SessionRelay', 'packages/core', '核心库 SessionRelay（采集/提取/检索/归档/MCP）'],
  ['plugins/dsh', 'packages/dsh-plugin', 'DSH 插件（把项目记忆注入 system prompt）'],
  ['integrations/zcode', 'packages/zcode-adapter', 'ZCode 适配器（SessionStart 开场简报）'],
  // [1021] Codex 适配器：与 ZCode 共用 brief-shared 同一份简报逻辑，只是配置面与 trust 步骤不同。
  //   发布树必须带它 —— 否则别人永远拿不到第三端（和当初面板的"本机能跑、别人拿不到"同型盲区）。
  ['integrations/codex', 'packages/codex-adapter', 'Codex 适配器（SessionStart 简报 + MCP + 技能）'],
  // [1021] 面板也纳进来：此前它只以 dsh-panel-*.zip 发在 Release，**源码不进仓库** ⇒
  //   想看/改它的人无从下手，而且与其它三端不对称（三端都有 packages/，面板没有）。
  //   面板零 npm 依赖（纯 Canvas + React 来自宿主），整目录搬过去即可。
  ['integrations/dsh-srelay-panel', 'packages/dsh-panel', 'DSH 记忆台面板（图谱/看板/经验/旋钮）'],
  ['integrations/skills/handoff-atlas', 'skills/handoff-atlas', '交接与全资源地图技能'],
];

// [1021] Codex 适配器在仓库里靠 ../zcode 拿共享简报模块（brief-shared/filters/turn/engine）。
// 但发布树里 packages/codex-adapter 的兄弟目录叫 zcode-adapter，路径对不上 ——
// install.mjs 有 HERE 回退，所以这里必须把这几个 .mjs **平铺**复制进 codex-adapter。
// 不加这一步的后果：下载包装完 hook 直接 ERR_MODULE_NOT_FOUND（ZCode 侧踩过一次的同型坑）。
const CODEX_SHARED = ['brief-shared.mjs', 'brief-filters.mjs', 'brief-turn.mjs', 'engine.mjs'];
for (const [src, dst, desc] of PLANS) {
  const before = stats.files;
  copyTree(path.join(ROOT, src), path.join(OUT, dst), stats);
  ok(dst.padEnd(28) + (stats.files - before) + ' 个文件  ' + desc);
}
// 工具：只带"能重现这套东西"的那些，一次性探针不带（它们留在工作区）
const TOOLS = [
  'ses-install.mjs', 'ses-rebuild.mjs', 'ses-pack-clients.mjs', 'check-versions.mjs', 'check-brief-filters.mjs',
  'ses-publish.mjs', 'ses-recall-probe.mjs', 'ses-purge-injected.mjs', 'ses-fix-message-count.mjs',
  '_mirror_dist.mjs', '_mirror_plugin.mjs', '_mirror_skills.mjs', '_probes-README.md',
];
fs.mkdirSync(path.join(OUT, 'tools'), { recursive: true });
let toolN = 0;
for (const t of TOOLS) {
  const s = path.join(ROOT, 'tools', t);
  if (!fs.existsSync(s)) { warn('工具缺失（跳过）: tools/' + t); continue; }
  copyTree(s, path.join(OUT, 'tools', t), stats); toolN++;
}
ok('tools/'.padEnd(28) + toolN + ' 个脚本（安装器/重建/守门/镜像/探针）');

// ── 3) 文档与仓库门面 ─────────────────────────────────────────────────────
// publish/ 就是仓库门面：README.md / README.en.md / INSTALL.md / LICENSE / .gitignore / CHANGELOG.md
// + docs/ + release/ —— 直接铺到目标根（模板与代码分开存，改文档不用动脚本）
copyTree(path.join(ROOT, 'publish'), OUT, stats);
ok('仓库门面（README / INSTALL / LICENSE / docs / release）');

// ── 4) 发布前自检 ─────────────────────────────────────────────────────────

// Codex 适配器的共享依赖平铺（见上面 CODEX_SHARED 的说明）
try {
  const zcSrc = path.join(ROOT, 'integrations', 'zcode');
  const cxDst = path.join(OUT, 'packages', 'codex-adapter');
  if (fs.existsSync(cxDst)) {
    let n = 0;
    for (const f of CODEX_SHARED) {
      const from = path.join(zcSrc, f);
      if (!fs.existsSync(from)) { say('  🔴 codex 共享依赖缺失: ' + f); continue; }
      fs.copyFileSync(from, path.join(cxDst, f));
      n++;
    }
    say('  ✅ codex-adapter 共享依赖 ' + n + '/' + CODEX_SHARED.length + ' 已平铺');
  }
} catch (e) { say('  🔴 codex 依赖复制失败: ' + String(e && e.message || e).slice(0, 100)); }

say('\n══ 发布前自检 ══');
const CHECK = [
  'README.md', 'README.en.md', 'INSTALL.md', 'LICENSE', '.gitignore',
  'packages/core/package.json', 'packages/core/src/bin/srelay.ts',
  'packages/dsh-plugin/index.js', 'packages/dsh-plugin/package.json',
  'packages/zcode-adapter/brief.mjs', 'packages/zcode-adapter/install.mjs',
  'packages/codex-adapter/brief.mjs', 'packages/codex-adapter/install.mjs',
  'skills/handoff-atlas/SKILL.md', 'skills/handoff-atlas/scripts/anchor_audit.mjs',
  'tools/ses-install.mjs', 'tools/check-versions.mjs',
];
for (const c of CHECK) {
  if (fs.existsSync(path.join(OUT, c))) ok(c); else bad('发布树缺文件: ' + c);
}
// README 里引用的相对路径必须真实存在（防止文档漂）
const readme = fs.readFileSync(path.join(OUT, 'README.md'), 'utf8');
const links = [...readme.matchAll(/\]\((\.?[^)#]+\.md)\)/g)].map((m) => m[1]);
let linkBad = 0;
for (const l of links) { if (!fs.existsSync(path.join(OUT, l))) { bad('README 链接指向不存在的文件: ' + l); linkBad++; } }
if (!linkBad) ok('README 内 ' + links.length + ' 个文档链接全部存在');

// 体积报告
const mb = (n) => (n / 1024 / 1024).toFixed(1) + 'MB';
say('\n  发布树：' + stats.files + ' 个文件 · ' + mb(stats.bytes) + '（跳过大文件/依赖 ' + stats.skipped + ' 项）');

// ── 5) 可选：git init + 首次提交 ─────────────────────────────────────────
if (GIT && !fail) {
  say('\n══ git init + 首次提交 ══');
  const g = (a) => execFileSync('git', a, { cwd: OUT, stdio: 'inherit' });
  g(['init', '-q', '-b', 'main']);
  g(['add', '-A']);
  g(['-c', 'user.name=rui08984-dot', '-c', 'user.email=rui08984-dot@users.noreply.github.com',
     'commit', '-q', '-m', 'chore: 发布树首次组装（core + DSH 插件 + ZCode 适配器 + 技能 + 工具）']);
  ok('已初始化仓库并完成首次提交（未配置远端、未推送）');
}

say('\n' + (fail ? '🔴 自检有 ' + fail + ' 项未过' : '✅ 发布树就绪：' + OUT));
if (!fail) {
  say('  下一步（发布动作，由人执行）：');
  say('    1) 复核 release/PUBLISH.md 的发布清单');
  say('    2) gh repo create <名字> --public --source "' + OUT + '" --push');
  say('    3) 把 artifacts/ses-offline-*.zip 挂到 Release（GitHub Release 资产，不进 git）');
}
process.exit(fail ? 1 : 0);