#!/usr/bin/env node
/**
 * SessionRelay · Codex SessionStart hook
 *
 * 契约来源（2026-10 官方文档 codex-docs.com/en/docs/hooks）：
 *   stdin  : { session_id, transcript_path, cwd, hook_event_name, model, permission_mode, source }
 *   stdout : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '...' } }
 *   纯文本 stdout 也会被当作额外 developer context；这里用 JSON 形态，与 ZCode/DSh 三端同构。
 *
 * 设计要点：
 *   1. **简报逻辑只有一份**（铁律：判据只许有一份）。这里不重写任何组装逻辑，
 *      直接 import ../zcode/brief-shared.mjs —— ZCode / Codex 两端的简报逐字相同。
 *   2. **失败不阻塞会话**：任何异常一律 exit 0 且 stdout 为空（hook 规范）。
 *      但只有 SRELAY_BRIEF_DEBUG=1 时才把原因打到 stderr —— 否则真故障会被"静默"。
 *   3. Codex 的 SessionStart 带 source（startup/resume/clear/compact/fork）。
 *      compact 之后重新注入尤其重要：压缩会丢掉上文，此时不补简报等于失忆。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 简报组装模块的位置在两种部署形态下不同：
 *   · 仓库里跑：integrations/codex/brief.mjs → ../zcode/brief-shared.mjs
 *   · 装好之后：~/.codex/hooks/statebrief/brief.mjs → ./brief-shared.mjs（安装器把它copy到同目录）
 * 所以**运行时**探测，而不是写死一个相对路径。写死的后果是「仓库里能跑，装完就崩」——
 * 而且会被顶层 catch 吞成空输出，表现为「钩子装了但从不注入」，极难查。
 */
async function loadShared() {
  const here = new URL('./brief-shared.mjs', import.meta.url);
  if (existsSync(fileURLToPath(here))) return import(here.href);
  return import(new URL('../zcode/brief-shared.mjs', import.meta.url).href);
}
const { buildBrief } = await loadShared();

const DBG = process.env.SRELAY_BRIEF_DEBUG === '1';
const dbg = (...a) => { if (DBG) console.error('[srelay-codex]', ...a) };

/** 读 stdin 的 hook 输入（Codex 每次给一个 JSON 对象） */
function readHookInput() {
  try {
    const raw = readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) { dbg('stdin 解析失败:', e.message); return {}; }
}

/** 内部目录不接（与 DSH shouldAutoInit、ZCode autoInitTarget 同规则） */
function isInternalDir(p) {
  if (!p) return true;
  const n = p.replace(/\\/g, '/').toLowerCase();
  if (!n || n === '/' || /^[a-z]:\/?$/.test(n)) return true;               // 盘符根
  if (n.includes('/appdata/') || n.includes('/node_modules/')) return true; // 安装目录
  if (n.includes('/.dsh/') || n.includes('/.codex/') || n.includes('/.zcode/')) return true;
  if (/\/(temp|tmp)\//.test(n) || n.includes('/windows/')) return true;
  return false;
}

/** 有 .git 往上找仓库根；否则用 cwd 本身 */
function resolveRoot(startDir) {
  if (!startDir || isInternalDir(startDir)) return null;
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return isInternalDir(startDir) ? null : startDir;
}

const emit = (ctx) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx },
}));

function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.cwd();
  const source = input.source || 'startup';
  dbg('source=' + source + ' cwd=' + cwd);

  const root = resolveRoot(cwd);
  if (!root) { dbg('内部目录/根目录，跳过'); process.exit(0); }

  // 找 CLI：优先环境变量，其次仓库内 dist
  const SRELAY = process.env.SRELAY_CLI
    || (existsSync(join(root, 'core', 'SessionRelay', 'dist', 'srelay.js'))
        ? join(root, 'core', 'SessionRelay', 'dist', 'srelay.js') : null);
  const srelay = (args) => {
    try {
      if (!SRELAY) return null;
      return execFileSync(process.execPath, [SRELAY, ...args],
        { cwd: root, timeout: 4000, encoding: 'utf8', windowsHide: true });
    } catch (e) { dbg('srelay ' + args.join(' ') + ' 失败:', e.message); return null; }
  };

  const hasStack = existsSync(join(root, '.sessionrelay'));

  // 自动接入：新工作区开箱即有（与 DSH / ZCode 同规则）
  if (!hasStack && SRELAY && !isInternalDir(root)) {
    try {
      execFileSync(process.execPath, [SRELAY, 'init', '--yes', '--backfill', 'none'],
        { cwd: root, timeout: 15000, windowsHide: true });
      dbg('已自动接入 ' + root);
    } catch (e) { dbg('自动接入失败:', e.message); }
  }

  if (!existsSync(join(root, '.sessionrelay'))) { dbg('未接入记忆库，零打扰'); process.exit(0); }

  const ctx = buildBrief(root, { srelay, dbg: DBG });
  if (ctx) { emit(ctx); dbg('已注入 ' + ctx.length + ' 字符'); }
  process.exit(0);
}

try { main(); } catch (e) {
  // hook 规范：失败=空输出，绝不阻塞会话
  if (DBG) console.error('[srelay-codex] 未捕获:', (e && e.message) || e);
  process.exit(0);
}
