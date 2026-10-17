#!/usr/bin/env node
/**
 * SessionRelay · Codex 集成安装器
 *
 * 干四件事（全部幂等、改前必备份）：
 *   ① hooks  → ~/.codex/hooks/statebrief/{brief.mjs, brief-shared.mjs, brief-filters.mjs}
 *   ② 注册 SessionStart hook → ~/.codex/hooks.json
 *   ③ 注册 MCP server      → ~/.codex/config.toml 的 [mcp_servers.sessionrelay]
 *   ④ 技能（可选）          → ~/.codex/skills/handoff-atlas/
 *
 * ⚠️ **装完不等于生效**（本框架最嫌恶的故障形态）：Codex 要求非托管 hook
 *    先在 /hooks 里审核并 trust 才会跑。这一步**只能由人做**，脚本做不了（做了也不该信）。
 *    所以安装最后会**明确打印这一步**，而不是打印"全部完成"让人以为已经好了。
 *
 * 用法:
 *   node install.mjs                 # 安装（hooks + MCP + 技能）
 *   node install.mjs --no-mcp        # 只装 hooks
 *   node install.mjs --no-skills     # 不装技能
 *   node install.mjs --uninstall     # 全部撤销
 *   node install.mjs --dry-run       # 只打印将要做什么
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CODEX = process.env.CODEX_HOME || join(homedir(), '.codex');
const HOOK_DIR = join(CODEX, 'hooks', 'statebrief');
const HOOKS_JSON = join(CODEX, 'hooks.json');
const CONFIG_TOML = join(CODEX, 'config.toml');
const SKILL_SRC = resolve(HERE, '..', 'skills', 'handoff-atlas');
const SKILL_DST = join(CODEX, 'skills', 'handoff-atlas');
const SRELAY_CLI = process.env.SRELAY_CLI || resolve(HERE, '..', '..', 'core', 'SessionRelay', 'dist', 'srelay.js');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const UNINSTALL = argv.includes('--uninstall');
const NO_MCP = argv.includes('--no-mcp');
const NO_SKILLS = argv.includes('--no-skills');

const log = (s) => console.log(s);
const act = (s) => log((DRY ? '[dry] ' : '') + s);

/** 改前备份，返回备份路径（同一秒内多次调用不覆盖） */
function backup(file) {
  if (!existsSync(file)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let dst = file + '.bak-' + ts;
  for (let i = 1; existsSync(dst); i++) dst = file + '.bak-' + ts + '-' + i;
  if (!DRY) copyFileSync(file, dst);
  return dst;
}

// ───────────────────────── ① 放 hook 文件 ─────────────────────────
function installHookFiles() {
  // ⚠️ 依赖清单**不手写**。手写的后果在 ZCode 侧真实发生过一次：
  //    清单里漏了 engine.mjs → 装好后 hook 直接 ERR_MODULE_NOT_FOUND →
  //    被顶层 catch 吞成空输出 → 表现为「装了但从不注入」，极难查。
  //    ZCode 那边的注释原话：「engine.mjs 必须在清单里：它是引擎解析的唯一入口」。
  //    这里改为：**凡是 zcode 目录下的 .mjs 依赖全拷**（install.mjs 是给人跑的，不是依赖，排除）。
  //    以后 brief-shared 再添新依赖，这里自动跟上，不会再犯同一个错。
  // 依赖目录在两种分发布局下不同：
  //   · 仓库里：integrations/codex/ → 兄弟目录 ../zcode（简报逻辑的权威源）
  //   · 下载包：codex-adapter/ 里依赖已**平铺**在同一层（因为 zip 里没有 ../zcode）
  // 探测而不是写死，否则「仓库里装得好、下载包一装就崩」——又是一个静默分叉。
  const siblingZcode = resolve(HERE, '..', 'zcode');
  const srcDir = existsSync(siblingZcode) ? siblingZcode : HERE;
  const deps = readdirSync(srcDir)
    .filter((f) => f.endsWith('.mjs') && f !== 'install.mjs' && f !== 'brief.mjs');
  if (srcDir === HERE) log('  （从下载包平铺布局读取依赖）');
  const files = ['brief.mjs', ...deps];
  if (!deps.includes('engine.mjs')) log('  ⚠️  没找到 engine.mjs —— 简报的引擎解析会缺失');
  if (!DRY) mkdirSync(HOOK_DIR, { recursive: true });
  for (const f of files) {
    const src = f === 'brief.mjs' ? join(HERE, 'brief.mjs') : join(srcDir, f);
    if (!existsSync(src)) { log('  ⚠️  缺文件 ' + src); continue; }
    act('  复制 ' + f);
    if (!DRY) copyFileSync(src, join(HOOK_DIR, f));
  }
}

// ───────────────────────── ② 注册 hook ─────────────────────────
function hookEntry() {
  const cmd = '"' + process.execPath + '" "' + join(HOOK_DIR, 'brief.mjs') + '"';
  return {
    matcher: 'startup|resume|clear|compact',
    hooks: [{
      type: 'command',
      command: cmd,
      statusMessage: '加载项目记忆简报',
      timeout: 20,
      additionalContextLimit: 6000,
    }],
  };
}

function registerHook() {
  let cfg = { description: 'SessionRelay 记忆简报（自动注入）', hooks: {} };
  if (existsSync(HOOKS_JSON)) {
    try { cfg = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')); }
    catch (e) { log('  ⚠️  hooks.json 解析失败（' + e.message + '），将备份后重建'); }
  }
  cfg.hooks = cfg.hooks || {};
  const list = (cfg.hooks.SessionStart = cfg.hooks.SessionStart || []);
  // 幂等：先摘掉我们自己的旧条目（按 command 里含 hooks/statebrief 识别）
  const kept = list.filter((g) => !JSON.stringify(g).includes('hooks/statebrief')
    && !JSON.stringify(g).includes('hooks\\statebrief'));
  const removed = list.length - kept.length;
  kept.push(hookEntry());
  cfg.hooks.SessionStart = kept;

  if (removed) act('  替换旧的 SessionStart 条目 ' + removed + ' 条');
  else act('  新增 SessionStart 条目');
  if (!DRY) { backup(HOOKS_JSON); writeFileSync(HOOKS_JSON, JSON.stringify(cfg, null, 2) + '\n'); }
}

function unregisterHook() {
  if (!existsSync(HOOKS_JSON)) return;
  let cfg;
  try { cfg = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')); } catch { return; }
  const list = cfg?.hooks?.SessionStart;
  if (!Array.isArray(list)) return;
  const kept = list.filter((g) => !JSON.stringify(g).includes('hooks/statebrief')
    && !JSON.stringify(g).includes('hooks\\statebrief'));
  if (kept.length === list.length) return;
  cfg.hooks.SessionStart = kept;
  if (!kept.length) delete cfg.hooks.SessionStart;
  if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
  act('  从 hooks.json 移除 SessionStart 条目');
  if (!DRY) { backup(HOOKS_JSON); writeFileSync(HOOKS_JSON, JSON.stringify(cfg, null, 2) + '\n'); }
}

// ───────────────────────── ③ 注册 MCP（TOML）─────────────────────────
// 只做**追加**：已经存在 [mcp_servers.sessionrelay] 就跳过；不存在就追加到文件末尾。
// 不做通用 TOML 解析/重写 —— 那会毁掉用户手写的注释与顺序。
function registerMcp() {
  if (!existsSync(SRELAY_CLI)) {
    log('  ⚠️  找不到 srelay CLI（' + SRELAY_CLI + '），跳过 MCP 注册');
    log('      先跑: node tools/ses-rebuild.mjs  或 npm run build');
    return;
  }
  const toml = existsSync(CONFIG_TOML) ? readFileSync(CONFIG_TOML, 'utf8') : '';
  if (/^\[mcp_servers\.sessionrelay\]/m.test(toml)) { log('  MCP 已注册，跳过'); return; }
  const block = [
    '',
    '# SessionRelay 记忆层（13 个工具：检索/详情/决策/未决/文件历史/相关推荐/统计/置顶写/恢复）',
    '[mcp_servers.sessionrelay]',
    'command = ' + JSON.stringify(process.execPath),
    'args = [' + JSON.stringify(SRELAY_CLI) + ', "serve"]',
    'enabled = true',
    '',
  ].join('\n');
  act('  追加 [mcp_servers.sessionrelay] 到 config.toml');
  if (!DRY) { backup(CONFIG_TOML); writeFileSync(CONFIG_TOML, toml.replace(/\s*$/, '') + block); }
}

function unregisterMcp() {
  if (!existsSync(CONFIG_TOML)) return;
  const toml = readFileSync(CONFIG_TOML, 'utf8');
  if (!/^\[mcp_servers\.sessionrelay\]/m.test(toml)) return;
  // 从该表头起到下一个 [ 表头之前，整段删掉
  const out = toml.replace(/(^|\n)# SessionRelay 记忆层[^\n]*\n\[mcp_servers\.sessionrelay\][\s\S]*?(?=\n\[|\s*$)/m, '');
  act('  从 config.toml 移除 [mcp_servers.sessionrelay]');
  if (!DRY) { backup(CONFIG_TOML); writeFileSync(CONFIG_TOML, out.replace(/\s*$/, '') + '\n'); }
}

// ───────────────────────── ④ 技能 ─────────────────────────
function installSkills() {
  if (!existsSync(SKILL_SRC)) { log('  ⚠️  找不到技能源 ' + SKILL_SRC + '，跳过'); return; }
  act('  复制 handoff-atlas → ' + SKILL_DST);
  if (!DRY) {
    mkdirSync(dirname(SKILL_DST), { recursive: true });
    try { rmSync(SKILL_DST, { recursive: true, force: true }); } catch { /* 已不存在 */ }
    copyDir(SKILL_SRC, SKILL_DST);
  }
}

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSafe(src)) {
    const s = join(src, e.name), d = join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}
function readdirSafe(p) {
  try { return readdirSync(p, { withFileTypes: true }); } catch { return []; }
}

// ───────────────────────── 主流程 ─────────────────────────
log('');
log('SessionRelay · Codex 集成' + (UNINSTALL ? '（卸载）' : '') + (DRY ? '（演练，不落盘）' : ''));
log('  CODEX_HOME = ' + CODEX);
log('');

if (UNINSTALL) {
  unregisterHook();
  if (!NO_MCP) unregisterMcp();
  if (existsSync(HOOK_DIR) && !DRY) { rmSync(HOOK_DIR, { recursive: true, force: true }); act('  删除 ' + HOOK_DIR); }
  if (existsSync(SKILL_DST) && !DRY) { rmSync(SKILL_DST, { recursive: true, force: true }); act('  删除 ' + SKILL_DST); }
} else {
  log('① hook 文件');
  installHookFiles();
  log('② 注册 SessionStart hook');
  registerHook();
  if (!NO_MCP) { log('③ 注册 MCP server'); registerMcp(); }
  if (!NO_SKILLS) { log('④ 安装技能'); installSkills(); }
}

log('');
if (!UNINSTALL && !DRY) {
  log('════════════════════════════════════════════════════════');
  log('⚠️  还差最后一步，**必须由你手动完成**：');
  log('');
  log('   在 Codex 里输入  /hooks');
  log('   → 找到 SessionRelay 的 SessionStart 条目');
  log('   → 审核并选 Trust');
  log('');
  log('   不 trust 的话，钩子**不会运行**，而且这是 Codex 的设计（安全）。');
  log('   症状是「装完了但什么都没注入」—— 不是坏了，是还没批准。');
  log('════════════════════════════════════════════════════════');
  log('');
  log('验证：新开一个会话，应该能看到【记忆简报】。');
  log('排错：SRELAY_BRIEF_DEBUG=1 再跑一次，看 stderr。');
}
