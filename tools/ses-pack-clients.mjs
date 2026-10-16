#!/usr/bin/env node
/**
 * ses-pack-clients.mjs —— 按客户端打独立下载包（给 Release 用）。
 *
 * 为什么不是只有一个全家桶离线包：
 *   用户的心智是「我用 DSH，我要 DSH 那份」。让他下一个 20MB 的全家桶再从里面挑目录，
 *   成功率远低于给他一个自带运行时的插件包，直接丢进 local-plugins/。
 *   全家桶仍然保留，给「新机器一次装齐」的人。
 *
 * 产出（写进 artifacts/）：
 *   dsh-plugin-<版本>.zip      DSH 插件，含 vendor 自包含运行时 → 解压丢 local-plugins/
 *   zcode-adapter-<版本>.zip   ZCode 适配器（三个 mjs + install.mjs + 说明）→ 跑 install.mjs
 *
 * 用法：node tools/ses-pack-clients.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLUGIN = path.join(ROOT, 'plugins', 'dsh');
const ZC = path.join(ROOT, 'integrations', 'zcode');
const OUTDIR = path.join(ROOT, 'artifacts');
const BT = String.fromCharCode(96);
const FENCE = BT + BT + BT;

let fail = 0;
const say = (s) => console.log(s);

async function loadFflate() {
  const cands = [
    path.join(ROOT, 'core/SessionRelay/node_modules/fflate/esm/index.mjs'),
    path.join(PLUGIN, 'vendor/node_modules/fflate/esm/index.mjs'),
  ];
  for (const c of cands) { if (!fs.existsSync(c)) continue; const m = await import(pathToFileURL(c).href).catch(() => null); if (m) return m; }
  return null;
}

const walkAll = (dir, base = '') => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walkAll(path.join(dir, e.name), rel)); else out.push(rel);
  }
  return out;
};
const ver = (p) => JSON.parse(fs.readFileSync(p, 'utf8')).version;
const C = (s) => BT + s + BT;

say('══ 按客户端打 Release 资产 ══');
const fflate = await loadFflate();
if (!fflate) { say('🔴 找不到 fflate（core/SessionRelay/node_modules 或插件 vendor）'); process.exit(1); }
fs.mkdirSync(OUTDIR, { recursive: true });
const results = [];

// ── 1) DSH 插件包（含 vendor）──
const pluginVer = ver(path.join(PLUGIN, 'package.json'));
if (!fs.existsSync(path.join(PLUGIN, 'vendor', 'dist', 'srelay.js'))) {
  say('🔴 插件 vendor 未生成——先跑 node tools/ses-rebuild.mjs'); fail++;
} else {
  const entries = {};
  for (const rel of walkAll(PLUGIN)) {
    const abs = path.join(PLUGIN, rel.split('/').join(path.sep));
    entries['dsh-plugin/' + rel] = new Uint8Array(fs.readFileSync(abs));
  }
  const howto = [
    '# DSH 插件包（自包含）', '',
    '这个包**不需要 npm、不需要联网、不需要本机装过 SessionRelay** —— vendor 里带了全部运行时。', '',
    '## 装法（三步）', '',
    '1. 解压，把 `dsh-plugin/` 整个目录复制到：',
    '   `<DSH 配置目录>/profiles/<你用的 profile>/local-plugins/dsh-srelay-brief/`',
    '   （Windows 一般在 `C:/Users/<你>/.dsh/`；profile 常见是 `web` / `desktop`）',
    '2. **重启 DSH**（常驻进程不重启 = 你看到的还是旧版）',
    '3. 新开一个会话，开场应出现 📋 看板 / 决策行', '',
    '## 验收', '', FENCE,
    'srelay --version    # 内核 CLI 可用（没装过内核见主仓库 INSTALL.md）',
    'srelay doctor       # 0 失败',
    'srelay brief        # 简报真的有内容（空 = 静默半失效）',
    FENCE, '',
    '## 排障', '',
    '| 症状 | 多半是 | 怎么办 |', '|---|---|---|',
    '| 开场什么都没有 | 项目还没建记忆库 | 到项目根跑 `srelay init` |',
    '| 简报是旧内容 | DSH 没重启 | 重启 DSH |',
    '| 插件像是没加载 | 目录放错 profile | 确认 local-plugins/ 在**你正在用的** profile 下 |',
    '| 插件加载失败且日志无报错 | 文件没进加载路径 | 用本包（已含 vendor）重装一次 |', '',
    '插件版本：' + pluginVer, '打包时间：' + new Date().toISOString(), '',
  ].join(String.fromCharCode(10));
  entries['dsh-plugin/README-INSTALL.md'] = new Uint8Array(Buffer.from(howto, 'utf8'));
  const buf = fflate.zipSync(entries, { level: 6 });
  const out = path.join(OUTDIR, 'dsh-plugin-' + pluginVer + '.zip');
  fs.writeFileSync(out, buf);
  results.push(['dsh-plugin-' + pluginVer + '.zip', buf.length, Object.keys(entries).length]);
  say('  ✅ dsh-plugin-' + pluginVer + '.zip  ' + (buf.length / 1024 / 1024).toFixed(1) + 'MB / ' + Object.keys(entries).length + ' 文件');
}

// ── 2) ZCode 适配器包 ──
if (!fs.existsSync(path.join(ZC, 'brief.mjs'))) { say('🔴 找不到 integrations/zcode/brief.mjs'); fail++; }
else {
  const entries = {};
  for (const rel of walkAll(ZC)) {
    const abs = path.join(ZC, rel.split('/').join(path.sep));
    entries['zcode-adapter/' + rel] = new Uint8Array(fs.readFileSync(abs));
  }
  const howto = [
    '# ZCode 适配器包', '',
    '让 ZCode 开场自动带上项目简报（看板 / 决策 / 最近在动的文件）。', '',
    '## 前提', '',
    '- 已装内核 CLI：`srelay` 能在命令行跑起来（没装见主仓库 INSTALL.md）',
    '- ZCode 配置目录通常是 `~/.zcode`', '',
    '## 装法（两条命令）', '', FENCE,
    'cd zcode-adapter',
    'node install.mjs            # 先看计划，不写任何东西',
    'node install.mjs --apply    # 真装：拷文件 + 注册 SessionStart hook',
    FENCE, '',
    '安装器会自动：① 拷三个 mjs 到 `<ZCode>/hooks/statebrief/` ② 往 `<ZCode>/cli/config.json` 注册 hook',
    '（**改前自动备份** `config.json.bak-<时间戳>`，失败可精确恢复）', '',
    '## 验收', '',
    '在真实项目目录里跑：', '', FENCE,
    'node "<ZCode>/hooks/statebrief/brief.mjs" "/你的项目路径"',
    '# 期望：一行 JSON，additionalContext 里有看板/决策/文件行',
    FENCE, '',
    '或者直接新开一个 ZCode 会话，看开场有没有「📍项目状态简报」。', '',
    '## 卸载', '',
    '删掉 `<ZCode>/hooks/statebrief/`，并用安装时留下的 `config.json.bak-*` 恢复配置。', '',
    '## 它怎么找内核', '',
    '三级解析：环境变量 `SRELAY_CLI` → 自带 `vendor/dist/srelay.js` → 全局 npm 安装路径。',
    '任何一级都找不到时**输出空**（hook 规范允许空输出），不会阻塞你的会话。', '',
    '打包时间：' + new Date().toISOString(), '',
  ].join(String.fromCharCode(10));
  entries['zcode-adapter/README-INSTALL.md'] = new Uint8Array(Buffer.from(howto, 'utf8'));
  const buf = fflate.zipSync(entries, { level: 9 });
  const out = path.join(OUTDIR, 'zcode-adapter-1.0.0.zip');
  fs.writeFileSync(out, buf);
  results.push(['zcode-adapter-1.0.0.zip', buf.length, Object.keys(entries).length]);
  say('  ✅ zcode-adapter-1.0.0.zip  ' + (buf.length / 1024).toFixed(0) + 'KB / ' + Object.keys(entries).length + ' 文件');
}

// ── 3) 台账 ──
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tl = ['# Release 资产台账（自动生成）', '', '| 文件 | 大小 | 文件数 | sha256 |', '|---|---|---|---|'];
for (const [name, size, n] of results) {
  tl.push('| ' + C(name) + ' | ' + (size / 1024 / 1024).toFixed(2) + 'MB | ' + n + ' | ' + C(sha(path.join(OUTDIR, name))) + ' |');
}
fs.writeFileSync(path.join(OUTDIR, 'RELEASE-ASSETS.md'), tl.join(String.fromCharCode(10)) + String.fromCharCode(10));
say(''); say('  台账 → artifacts/RELEASE-ASSETS.md');
say(fail ? String.fromCharCode(10) + '🔴 有 ' + fail + ' 项未完成' : String.fromCharCode(10) + '✅ 客户端包就绪');
process.exit(fail ? 1 : 0);