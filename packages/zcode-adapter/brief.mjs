#!/usr/bin/env node
// 状态栈 L4 · SessionStart 开场自动简报（ZCode/Node 侧 wrapper）
// [fork 0924] 逻辑本体在 brief-shared.mjs（与 pi 扩展共用的单一事实源）——本文件只剩 hook 契约：
// 三层判定 + 简报组装委托。逻辑修改一律改 shared，别在这里加。
// 任何失败=空输出=不阻塞会话（hook 规范：空输出合法）
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename, dirname, resolve, sep } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { buildBrief } from './brief-shared.mjs';

// [fork 1016 · 可发布化] 原先这两个是**写死的本机绝对路径**——别人 clone 走跑不起来，
// 而且本机换 node 位置也会静默失效。改成：env 覆盖 → 自带 vendor → 全局 npm 探测，三条都失败才空输出。
// 解析规则（与 DSH 插件 project-resolve 同风格：显式 > 随包 > 环境）：
//   1) 环境变量 SRELAY_CLI / SRELAY_NODE
//   2) hook 目录旁的 vendor：<hook>/vendor/dist/srelay.js（离线包形态）
//   3) 全局 npm 安装：<npm_prefix>/node_modules/@ewanjasper/sessionrelay/dist/srelay.js
const NODE = process.env.SRELAY_NODE || process.execPath; // 显式 node：不赌 PATH（红 P2）
function resolveSrelay() {
  if (process.env.SRELAY_CLI && existsSync(process.env.SRELAY_CLI)) return process.env.SRELAY_CLI;
  const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const candidates = [
    join(here, 'vendor', 'dist', 'srelay.js'),
    join(here, '..', 'vendor', 'dist', 'srelay.js'),
  ];
  const npmPrefix = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  candidates.push(join(npmPrefix, 'npm', 'node_modules', '@ewanjasper', 'sessionrelay', 'dist', 'srelay.js'));
  candidates.push('/usr/lib/node_modules/@ewanjasper/sessionrelay/dist/srelay.js');
  candidates.push('/usr/local/lib/node_modules/@ewanjasper/sessionrelay/dist/srelay.js');
  for (const c of candidates) { try { if (existsSync(c)) return c; } catch {} }
  return null;
}
const SRELAY = resolveSrelay();
const DBG = process.env.SRELAY_BRIEF_DEBUG === '1'; // 排障开关：错误走 stderr（不污染 hook JSON）
const root = process.env.ZCODE_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
/** 从 root 向上找第一个含 .git 的目录；找不到返回 null（与 DSH 侧 findGitRoot 同规则） */
function isGitRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * [fork 1014 晚] 黑名单：这些地方绝不建记忆库。
 * 与 DSH 侧 project-resolve.mjs 的 isInternalDir 同规则（规则只有一处语义，两边同步改）。
 * 放开自动接入后，没有 .git 的文件夹也会自动建库，所以必须挡住：
 *   临时目录（审计实测 16 个注册表候选里 12 个是 Temp 沙盒）、DSH 自身、npm 全局、盘符根。
 */
function isInternalDir(dir) {
  // ⚠️ 必须先 resolve 再判盘符根：调用方可能传 'D:/'（正斜杠），
  // 直接对原串跑 /^[A-Za-z]:\\?$/ 会漏掉——resolve 后才统一成 'D:\'。
  const d = resolve(dir).toLowerCase();
  if (/^[a-z]:\\?$/.test(d)) return true; // 盘符根
  const tmp = resolve(tmpdir()).toLowerCase();
  if (d === tmp || d.startsWith(tmp + sep)) return true;
  const home = homedir().toLowerCase();
  const blocked = [
    join(home, '.dsh'),
    join(home, '.sessionrelay-registry'),
    join(home, '.zcode'),
    join(home, '.claude'),
    join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm'),
    join(home, 'AppData', 'Local', 'Programs', 'DeepSeek Harness'),
    join(home, 'AppData', 'Roaming', '@deepseek-ai'),
  ];
  for (const p of blocked) {
    const bp = resolve(p).toLowerCase();
    if (d === bp || d.startsWith(bp + sep)) return true;
  }
  return false;
}

/** 自动接入目标：有 .git → 仓库根；没有 → root 本身。黑名单/已建库 → null */
function autoInitTarget(startDir) {
  if (existsSync(join(startDir, '.sessionrelay', 'relay.sqlite'))) return null;
  if (isInternalDir(startDir)) return null;
  let gitRoot = null;
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, '.git'))) { gitRoot = dir; break; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const target = gitRoot ?? startDir;
  if (isInternalDir(target)) return null;
  return target;
}

const emit = (ctx) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx }
}));
const srelay = (args) => {
  try {
    if (!SRELAY) return null; // 找不到 CLI：空输出 = 不阻塞会话（hook 规范）
    return execFileSync(NODE, [SRELAY, ...args], { cwd: root, timeout: 4000, encoding: 'utf8', windowsHide: true });
  } catch { return null; }
};

try {
  const hasStack = existsSync(join(root, '.sessionrelay'));
  const scratchDir = join(root, '.scratch');
  const handoffDir = join(scratchDir, 'handoff');
  // 历史信号=交接链（.scratch/handoff/*.md）或进度锚（.scratch/ 直属 *PROGRESS*.md，progress-anchor 约定锚位）
  const hasHandoff = existsSync(handoffDir) && readdirSync(handoffDir).filter((f) => f.endsWith('.md')).length > 0;
  const hasAnchors = existsSync(scratchDir) && readdirSync(scratchDir).some((f) => f.endsWith('.md') && /PROGRESS/i.test(f));
  const hasHistory = hasHandoff || hasAnchors;

  // [fork 1014 晚] 三层判定③之前：真实目录一律自动接入（放开规则）。
  // 演化：早版只认 .git 强信号 → 用户新建的无 .git 工作区在 ZCode 里也要自己说"接入"，
  // 与"新建工作区即可捕捉"的预期不符。现改为黑名单制：除了临时目录 / DSH 自身 /
  // npm 全局 / 盘符根，全都自动接。有 .git 仍向上找仓库根（monorepo 安全）。
  // 与 DSH 侧 shouldAutoInit 同规则。
  if (!hasStack && !hasHistory) {
    const target = autoInitTarget(root);
    if (target) {
      // init 代价实测 154ms（--backfill none；默认回填 1050ms），且可逆（删目录即消失）。
      // SessionStart hook 每会话只跑一次，同步 init 的代价可接受。
      try {
        if (SRELAY) execFileSync(NODE, [SRELAY, 'init', '--yes', '--backfill', 'none'], { cwd: target, timeout: 15000, windowsHide: true });
      } catch { /* init 失败不阻塞会话，下轮再试 */ }
      // init 后 hasStack 可能仍未就绪（异步竞态），继续往下走正常简报逻辑
      if (existsSync(join(target, '.sessionrelay'))) hasStack = true;
      // 采集源校正：本机装着 DSH 时 sources 必须含 'dsh'。init 靠 detectSources()
      // 自动探测，而 dsh 探测项是 fork 加的——上游原版/npx 那份没有它，建出的库
      // 会「看着成功但 DSH 会话永远采不进去，简报永远空，且不报错」。
      try {
        const dshDir = join(homedir(), '.dsh', 'sessions');
        const cfgPath = join(target, '.sessionrelay', 'config.json');
        if (existsSync(dshDir) && existsSync(cfgPath)) {
          const j = JSON.parse(readFileSync(cfgPath, 'utf8'));
          const src = j?.capture?.sources;
          if (Array.isArray(src) && !src.includes('dsh')) {
            src.push('dsh');
            writeFileSync(cfgPath, JSON.stringify(j, null, 2));
            if (DBG) console.error('[statebrief] 采集源校正：已把 dsh 补进 ' + cfgPath);
          }
        }
      } catch { /* 校正失败不阻塞会话 */ }
    }
  }

  if (!hasStack && !hasHistory) process.exit(0); // 三层判定③：普通目录，零打扰

  if (!hasStack && hasHistory) {
    // 三层判定②：老项目未接入状态栈 → 给一键接入入口
    emit(`【状态栈提示】${basename(root)} 检测到历史状态信号（${hasHandoff ? '交接链' : '进度锚'}）但未接入状态栈。用户说"接入"即执行：srelay init → 从交接链/锚点生成 progress.md 看板与 architecture.mmd。本轮先按原文件工作即可。`);
    process.exit(0);
  }

  // 三层判定①：栈项目 → 组装简报（逻辑在 brief-shared.mjs，双端同源）
  const ctx = buildBrief(root, { srelay, dbg: DBG });
  if (ctx) emit(ctx);
  process.exit(0);
} catch (e) {
  if (DBG) console.error('[statebrief]', (e && e.message) || e);
  process.exit(0);
}
