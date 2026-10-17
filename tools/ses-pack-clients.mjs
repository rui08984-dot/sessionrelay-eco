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
// ZCode 适配器没有 package.json，版本号在这里**只准有一处**（此前散在三行里，改名容易漏）
const ZCODE_ADAPTER_VERSION = '1.0.2';
const ZCODE_ZIP = 'zcode-adapter-' + ZCODE_ADAPTER_VERSION + '.zip';
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
  const out = path.join(OUTDIR, ZCODE_ZIP);
  fs.writeFileSync(out, buf);
  results.push([ZCODE_ZIP, buf.length, Object.keys(entries).length]);
  say('  ✅ ' + ZCODE_ZIP + '  ' + (buf.length / 1024).toFixed(0) + 'KB / ' + Object.keys(entries).length + ' 文件');
}


// ── 2b) Codex 适配器包（1021 新增：第三个客户端，此前不在任何发布通道里）──
// 病历：Codex 适配器做完、本机也装通了，但 ses-pack-clients 只收「DSH + ZCode」——
//   于是**别人永远拿不到 Codex 那一份**，而本机是好的（和面板当时同一种「本机能跑」盲区）。
// 打包要点：Codex 的 brief.mjs 依赖 brief-shared/brief-filters/brief-turn/engine 四个模块，
//   它们在仓库里住在 ../zcode（权威源，只有一份实现）。zip 里没有这个兄弟目录，
//   所以**平铺**打在同一层——brief.mjs 的运行时探测会先找 ./brief-shared.mjs，正好命中。
const CX = path.join(ROOT, 'integrations', 'codex');
const CODEX_ADAPTER_VERSION = '1.0.0';
const CODEX_ZIP = 'codex-adapter-' + CODEX_ADAPTER_VERSION + '.zip';
if (!fs.existsSync(path.join(CX, 'brief.mjs'))) { say('🔴 找不到 integrations/codex/brief.mjs'); fail++; }
else if (!fs.existsSync(path.join(CX, 'install.mjs'))) { say('🔴 找不到 integrations/codex/install.mjs'); fail++; }
else {
  const entries = {};
  for (const rel of walkAll(CX)) {
    const abs = path.join(CX, rel.split('/').join(path.sep));
    entries['codex-adapter/' + rel] = new Uint8Array(fs.readFileSync(abs));
  }
  // 平铺带上简报逻辑的四个依赖（与 ZCode 适配器逐字相同 —— 只有一份实现）
  let deps = 0;
  for (const f of fs.readdirSync(ZC)) {
    if (!f.endsWith('.mjs') || f === 'install.mjs' || f === 'brief.mjs') continue;
    entries['codex-adapter/' + f] = new Uint8Array(fs.readFileSync(path.join(ZC, f)));
    deps++;
  }
  if (deps < 4) say('  ⚠️ Codex 依赖只带了 ' + deps + ' 个（期望 ≥4：shared/filters/turn/engine）');
  const howto = [
    '# Codex 适配器包', '',
    '让 Codex 开场自动带上项目简报（看板 / 决策 / 最近在动的文件），并让它能**主动**检索和记录。', '',
    '## 前提', '',
    '- 已装内核 CLI：`srelay` 能在命令行跑起来（没装见主仓库 INSTALL.md）',
    '- Codex 配置目录通常是 `~/.codex`（Windows: `C:/Users/<你>/.codex`）', '',
    '## 装法', '', FENCE,
    'cd codex-adapter',
    'node install.mjs --dry-run     # 先看计划，不写任何东西',
    'node install.mjs               # 真装：钩子 + MCP + 技能',
    FENCE, '',
    '安装器做四件事（**全部幂等、改前必备份**）：',
    '① 拷 brief 依赖到 `<Codex>/hooks/statebrief/`',
    '② 注册 SessionStart 钩子到 `<Codex>/hooks.json`',
    '③ 注册 MCP server 到 `<Codex>/config.toml`（`[mcp_servers.sessionrelay]`，13 个工具）',
    '④ 装交接技能到 `<Codex>/skills/handoff-atlas/`', '',
    '只想装一部分：`--no-mcp` / `--no-skills`；撤销：`--uninstall`。', '',
    '## ⚠️ 装完还差一步：必须手动 Trust', '',
    '**这是 Codex 的安全设计，不是 bug。** 非托管 hook 必须先人工审核并 trust 才会运行。', '',
    FENCE,
    '在 Codex 里输入  /hooks',
    '  → 找到 SessionRelay 的 SessionStart 条目',
    '  → 审核后选择 Trust',
    FENCE, '',
    '**不 trust 的症状**：装好了，但什么都没注入 —— 看着像坏了，其实只是还没批准。',
    '（这正是本框架最嫌恶的「装好了 ≠ 生效了」，所以安装器最后不会打印「全部完成」。）', '',
    '## 验收', '',
    '带调试开关手动跑一次钩子，看它到底说了什么：', '', FENCE,
    '# Windows PowerShell',
    "$env:SRELAY_BRIEF_DEBUG='1'",
    "echo '{\"cwd\":\"D:/你的项目\",\"hook_event_name\":\"SessionStart\",\"source\":\"startup\"}' | node ~/.codex/hooks/statebrief/brief.mjs",
    FENCE, '',
    '- **有 JSON 输出** → 钩子本身好的，问题在 trust 那步',
    '- **空输出 + stderr 有原因** → 按 stderr 修（多半是找不到 srelay CLI）', '',
    '或者直接新开一个 Codex 会话，看开场有没有「📍 项目状态简报」。', '',
    '## 它和 ZCode 适配器的关系', '',
    '**简报逻辑是同一份**（`brief-shared.mjs`，两端注入内容逐字相同），',
    '差别只在：Codex 的配置是 `hooks.json` + `config.toml`，且**多一道 trust 审核**。', '',
    '打包时间：' + new Date().toISOString(), '',
  ].join(String.fromCharCode(10));
  entries['codex-adapter/README-INSTALL.md'] = new Uint8Array(Buffer.from(howto, 'utf8'));
  const buf = fflate.zipSync(entries, { level: 9 });
  const out = path.join(OUTDIR, CODEX_ZIP);
  fs.writeFileSync(out, buf);
  results.push([CODEX_ZIP, buf.length, Object.keys(entries).length, deps]);
  say('  ✅ ' + CODEX_ZIP + '  ' + (buf.length / 1024).toFixed(0) + 'KB / ' + Object.keys(entries).length + ' 文件（含 ' + deps + ' 个共享依赖）');
}

// ── 3) 记忆台面板包（1017 夜新增；此前**不在任何发布通道里**）──
// 病历：面板做完了、也装到本机 profile 了，但 ses-pack-clients 只收「DSH 简报插件 + ZCode 适配器」——
//   于是**别人永远拿不到面板**，而本机却是好的（典型的「本机能跑」盲区）。
const PANEL = path.join(ROOT, 'integrations', 'dsh-srelay-panel');
if (!fs.existsSync(path.join(PANEL, 'lib', 'client.js'))) { say('🔴 找不到 integrations/dsh-srelay-panel/lib/client.js'); fail++; }
else if (!fs.existsSync(path.join(PANEL, 'vendor', 'dist', 'panel.js'))) {
  say('🔴 面板 vendor/dist/panel.js 缺失——先跑 node tools/ses-rebuild.mjs（面板零 npm 依赖，但内核 dist 要带上）'); fail++;
} else {
  const panelVer = ver(path.join(PANEL, 'package.json'));
  const entries = {};
  for (const rel of walkAll(PANEL)) {
    if (rel.split('/').includes('node_modules')) continue;
    const abs = path.join(PANEL, rel.split('/').join(path.sep));
    entries['dsh-srelay-panel/' + rel] = new Uint8Array(fs.readFileSync(abs));
  }
  const howto = [
    '# 记忆台面板包（DSH 原生插件）', '',
    '给 DSH 左栏加一个「记忆台」入口：总览 / 经验 / 压缩 / 旋钮 / 动作 五页，数据全来自内核。', '',
    '## 装法（一条命令，推荐）', '', FENCE,
    'node tools/ses-panel-install.mjs --apply --profiles web,desktop',
    FENCE, '',
    '## ⚠️ profile 别只写 web', '',
    '实测 DSH 桌面版加载的是 **desktop** profile（所有引用 .dsh/profiles 的进程全是 desktop，零个 web）。',
    '装错了的症状是：重启了 DSH 但左栏始终没按钮，**而且插件启动日志一片空白**（宿主半压根没被 import）。', '',
    '## 手动装（没有仓库时）', '',
    '把 dsh-srelay-panel/ 复制到 <DSH>/profiles/<profile>/local-plugins/，',
    '再把包名加进该 profile 的 package.json：dependencies 与 dsh.profile.bundles 各加一条。', '',
    '## 验收', '', FENCE,
    'curl http://127.0.0.1:19387/srelay/api/diagnostics',
    '# 期望 HTTP 200（404 = 宿主半没加载）',
    FENCE, '',
    '## 排障', '', '| 症状 | 多半是 | 怎么办 |', '|---|---|---|',
    '| 左栏没按钮 + 启动日志空白 | 装到了不会被加载的 profile | 按上面那条命令装 web,desktop |',
    '| 路由 404 | 同上（宿主半没加载） | 同上 |',
    '| 按钮在但取数报错 | 面板的 vendor/dist 缺内核 | 重跑 ses-rebuild 后重装 |', '',
    '面板版本：' + panelVer, '打包时间：' + new Date().toISOString(), '',
  ].join(String.fromCharCode(10));
  entries['dsh-srelay-panel/README-INSTALL.md'] = new Uint8Array(Buffer.from(howto, 'utf8'));
  const buf = fflate.zipSync(entries, { level: 6 });
  const out = path.join(OUTDIR, 'dsh-panel-' + panelVer + '.zip');
  fs.writeFileSync(out, buf);
  results.push(['dsh-panel-' + panelVer + '.zip', buf.length, Object.keys(entries).length]);
  say('  ✅ dsh-panel-' + panelVer + '.zip  ' + (buf.length / 1024 / 1024).toFixed(1) + 'MB / ' + Object.keys(entries).length + ' 文件');
}

// ── 4) 台账 ──
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tl = ['# Release 资产台账（自动生成）', '', '| 文件 | 大小 | 文件数 | sha256 |', '|---|---|---|---|'];
for (const [name, size, n] of results) {
  tl.push('| ' + C(name) + ' | ' + (size / 1024 / 1024).toFixed(2) + 'MB | ' + n + ' | ' + C(sha(path.join(OUTDIR, name))) + ' |');
}
fs.writeFileSync(path.join(OUTDIR, 'RELEASE-ASSETS.md'), tl.join(String.fromCharCode(10)) + String.fromCharCode(10));
say(''); say('  台账 → artifacts/RELEASE-ASSETS.md');
say(fail ? String.fromCharCode(10) + '🔴 有 ' + fail + ' 项未完成' : String.fromCharCode(10) + '✅ 客户端包就绪');
process.exit(fail ? 1 : 0);