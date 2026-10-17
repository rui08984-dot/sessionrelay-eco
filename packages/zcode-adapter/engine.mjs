// engine.mjs —— 核心引擎（dist/recall.js）的**唯一**解析点（ZCode 侧）
//
// 为什么要单独一个文件：这段候选路径原先内联在 brief-turn.mjs 里，而 brief-shared.mjs 也需要
// 引擎（呈现层折叠要调核心那一份判据 foldNearDuplicates）。抄第二份候选表 = 又一个分叉源，
// 而本项目吃够了"两侧手抄漂移"的亏（brief-filters.mjs 的先例）。
//
// 候选顺序（保持不变，改动要同步守门 L 段）：环境变量 → 安装前缀 → 系统全局目录。
// 拿不到就返回 null，调用方**静默降级**（宁可少一个功能，也不要抛出来打断 hook）。
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

const DEBUG = !!(process.env.SRELAY_HOOK_DEBUG || process.env.SRELAY_DEBUG);
const dbg = (...a) => { if (DEBUG) console.error('[srelay-engine]', ...a); };

/** @returns {Promise<{ mod: any, from: string } | null>} */
export async function loadEngine() {
  const cands = [];
  if (process.env.SRELAY_RECALL) cands.push(process.env.SRELAY_RECALL);
  if (process.env.SRELAY_CLI_PATH) cands.push(join(dirname(process.env.SRELAY_CLI_PATH), 'recall.js'));
  if (process.env.SRELAY_CLI) cands.push(join(dirname(process.env.SRELAY_CLI), 'recall.js'));
  if (process.env.SRELAY_HOME) cands.push(join(process.env.SRELAY_HOME, 'core/SessionRelay/dist/recall.js'));
  const npmPrefix = process.env.APPDATA || join(os.homedir(), 'AppData', 'Roaming');
  cands.push(join(npmPrefix, 'npm', 'node_modules', '@ewanjasper', 'sessionrelay', 'dist', 'recall.js'));
  cands.push('/usr/lib/node_modules/@ewanjasper/sessionrelay/dist/recall.js');
  cands.push('/usr/local/lib/node_modules/@ewanjasper/sessionrelay/dist/recall.js');
  for (const c of cands) {
    if (!c || !existsSync(c)) { dbg('候选不存在:', c); continue; }
    try {
      const mod = await import(pathToFileURL(c).href);
      dbg('引擎来自', c);
      return { mod, from: c };
    } catch (e) { dbg('候选加载失败', c, e && e.message); }
  }
  dbg('没拿到核心引擎（recall.js）');
  return null;
}
