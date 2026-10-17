#!/usr/bin/env node
// UserPromptSubmit hook：**每轮**按你这句话做一次相关召回，注入一小段。
//
// 与 SessionStart 的分工：
//   - SessionStart（brief.mjs）：开场给"项目在做什么"——看板/决策/文件，一次性；
//   - 本文件：**每一轮**给"与你这句话相关的**经验**与**旧决策**"——增量、按需。
//
// 三条硬约束（都是实测逼出来的）：
//   ① **只查 SQLite、不调模型、不起子进程**——hook 是每次提交起一个进程，冷启动已经很贵；
//   ② **没有相关命中就输出空**（hook 规范允许空输出）——空输出优于塞噪声；
//   ③ **预算极小**：经验 ≤200 字符 / ≤3 条，旧决策 ≤2 条。它抢的是你每次输入的上下文预算。
//
// ═══ [1016 收口] 「相不相关」只有一份实现 ═══
// 本文件此前自己写了两样东西，两样都出过事：
//   · 🌍 段与 📌 段用的**不是同一把尺子**：经验段没命中会静默，决策段只要"任一 2 字滑窗"
//     偶然重合（我写 / 么样 / 个怎）就判相关 ⇒ 实测问"今天天气怎么样，帮我写一首关于春天的诗吧"
//     注入了 1~2 条不相干决策（红队 B 7.3）；
//   · 可见性 SQL 自己抄了一份（缺 workspace 分支），核心库改了它吃不到（红队 A-5）。
// 现在：两段都调核心库 dist/recall.js 的 **同一个闸**
//   - 经验：pickForInjection（闸1 定级 + 闸2 相关性 + 可见性 + 预算，一步到位）
//   - 决策：gate2Score（同一个闸2 的打分）
//
// ═══ 降级说明（别再自己造兜底判据）═══
// 拿不到 recall.js ⇒ 两段都**不出现**。旧版这里是"逐字退回旧行为"（另一套打分），
// 而那正是"看起来在工作、其实用了另一套规则"的静默失效：仓库副本与部署副本因此分叉过一次，
// 谁都没发现（红队 B 7.2）。现在宁可少给：缺席是**看得见**的（没有 📍 行），
// 而错判是看不见的。排障时设 SRELAY_HOOK_DEBUG=1 会打印引擎来源与缺席原因。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { DatabaseSync = null; }

const DEBUG = !!(process.env.SRELAY_HOOK_DEBUG || process.env.SRELAY_DEBUG);
const dbg = (...a) => { if (DEBUG) console.error('[srelay-turn]', ...a); };

// 引擎候选（顺序：显式覆盖 → 装在哪找哪 → npm 全局 → 系统级）。
// ⚠️ 这里曾经用 `path.join` 却没 import path、又用了没 import 的 pathToFileURL ⇒ 整个 try 抛错、
//    被 catch 吞掉、**静默退回旧排序**（红队 B 7.2 抓到）。所以：候选循环整体包 try，
//    但每一次命中都记下来源，DEBUG 时打印；守门 L 段会断言"默认环境下能拿到引擎"。
// [1017] 引擎解析统一交给 engine.mjs（同一份候选表）——原先内联在这里，而 brief-shared.mjs
// 也需要引擎 ⇒ 抄第二份候选表就是又一个两侧漂移源。DEBUG 语义与来源打印保持不变。
import { loadEngine } from './engine.mjs';
const __loaded = await loadEngine();
const recallMod = __loaded ? __loaded.mod : null;
const recallFrom = __loaded ? __loaded.from : '';
if (!recallMod) dbg('没拿到核心引擎（recall.js）⇒ 本轮不注入任何相关内容');

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

/**
 * 项目根：判据**只在核心库里**（含"主目录/临时目录不参与向上认领"与"要有真项目标记"——
 * 全局经验库也住在 ~/.sessionrelay 名下，只看目录会把主目录误判成项目）。
 *
 * ⚠️ 这里曾经还有一份"同规"的本地实现，它是**死代码**：引擎缺席时下面整段都不注入，
 * 本地判出来的 root 永远没人用。删掉它 = 少一份会漂移的副本（code review 抓到）。
 */
function findRoot(start) {
  if (!start || !recallMod || typeof recallMod.findRelayRoot !== 'function') return null;
  try { return recallMod.findRelayRoot(start); } catch { return null; }
}

/**
 * 用核心库引擎（recall.js）把会话按相关性排好序 —— 同一套实现，两端共吃改进。
 * 拿不到 recall.js / 拿不到 project_id → 返回 null，调用方退回"最近 N 场"。
 */
function engineRankedSessions(db, root, prompt) {
  if (!recallMod || !prompt) return null;
  try {
    const pid = db.prepare('SELECT project_id AS p FROM sessions LIMIT 1').get();
    if (!pid || !pid.p) return null;
    const hits = recallMod.searchSessions(db, { project: String(pid.p), query: prompt, limit: 12 });
    if (!hits || hits.length === 0) return null;
    const out = [];
    for (const h of hits) {
      const r = db.prepare('SELECT decisions FROM sessions WHERE id = ?').get(String(h.sessionId));
      if (r && r.decisions) out.push(r);
    }
    return out.length ? out : null;
  } catch { return null; }
}

/** [1016] 决策候选池（按需取，别无条件多扫）：引擎排过序的会话优先，不够时再补"最近 80 场" */
function recentDecisionRows(db) {
  return db.prepare('SELECT decisions FROM sessions'
    + ' WHERE decisions IS NOT NULL AND length(decisions) > 2'
    + ' AND (origin IS NULL OR origin <> ?)'
    + ' ORDER BY coalesce(last_event_at, created_at) DESC LIMIT 80').all('workflow');
}

/** 从若干会话行里筛出过闸的决策（text 去重，按分数排） */
function collectHits(rows, prompt, seen) {
  const hits = [];
  for (const r of rows) {
    let ds = [];
    try { ds = JSON.parse(r.decisions); } catch { continue; }
    for (const d of ds) {
      const text = String(d && d.text ? d.text : d || '');
      if (!text || seen.has(text)) continue;
      seen.add(text);
      const s = recallMod.gate2Score(prompt, text);
      // pass 的判据在核心库（gate2Score 一处）：只共享一个 2 字实词不算相关。
      // ⚠️ 别改成 score > 0 —— 那正是"写诗题注入'跳下一首'"（只共享「一首」）的入口。
      if (s.pass) hits.push({ text, score: s.score });
    }
  }
  return hits;
}

/** 🌍 经验段：判据（闸1+闸2+可见性+预算）全在核心库，本文件只渲染 */
function experiencesFor(root, prompt) {
  if (!DatabaseSync || !recallMod) return '';
  const home = process.env.SRELAY_GLOBAL_HOME || join(os.homedir(), '.sessionrelay');
  const f = join(home, 'global.sqlite');
  if (!existsSync(f)) return '';
  let db = null;
  try {
    db = new DatabaseSync(f, { readOnly: true });
    const rows = recallMod.pickForInjection(db, {
      workspaceId: recallMod.resolveWorkspaceId(root),
      domain: recallMod.resolveDomain(root),
      query: prompt,
      top: 3,
      maxChars: 200,
    });
    if (!rows || rows.length === 0) return '';
    const body = rows.map((r) => String(r.text || '')).filter(Boolean).join('；');
    return body ? '🌍 经验：' + body : '';
  } catch { return ''; } finally { try { db?.close(); } catch { /* 已关闭 */ } }
}

/** 📌 旧决策段：**与经验段同一把尺子**（核心库 gate2Score），没命中就整段不出现 */
function decisionsFor(root, prompt) {
  if (!DatabaseSync || !recallMod) return '';
  const f = join(root, '.sessionrelay', 'relay.sqlite');
  if (!existsSync(f)) return '';
  let db = null;
  try {
    db = new DatabaseSync(f, { readOnly: true });
    const seen = new Set();
    // 候选池：引擎排过序的会话优先；引擎不可用（返回 null）才退回"最近 80 场"这个旧口径。
    //
    // ⚠️ 实测过"引擎池没出结果时再补扫最近 80 场"，**不采纳**：那个池子里有抽取噪声
    //    （口语转录被当成决策），补扫会把"只共享「不够的」"这种垃圾顶上来 ——
    //    预算只有 2 个名额，而本项目的第一原则是**空输出优于塞噪声**（红队 B 7.3 就是这条）。
    //    代价是召回略低（实测 8 题里少 1 题），认了。
    const rows = engineRankedSessions(db, root, prompt) || recentDecisionRows(db);
    const hits = collectHits(rows, prompt, seen);
    hits.sort((a, b) => b.score - a.score);
    const picked = hits.slice(0, 2).map((h) => '· ' + (h.text.length > 60 ? h.text.slice(0, 60) + '…' : h.text));
    return picked.length ? '📌 相关旧决策：' + String.fromCharCode(10) + picked.join(String.fromCharCode(10)) : '';
  } catch { return ''; } finally { try { db?.close(); } catch { /* 已关闭 */ } }
}

const input = readStdin();
const prompt = String(input.prompt || input.user_prompt || '');
const cwd = String(process.env.ZCODE_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
const root = findRoot(cwd);
dbg('cwd=', cwd, 'root=', root, 'engine=', recallFrom || '(无)');

// 没有记忆库 = 静默（hook 规范允许空输出）；这样也不会打扰没接记忆的项目
if (root && prompt && recallMod) {
  const parts = [];
  try { const e = experiencesFor(root, prompt); if (e) parts.push(e); } catch { /* 空 */ }
  try { const d = decisionsFor(root, prompt); if (d) parts.push(d); } catch { /* 空 */ }
  if (parts.length > 0) {
    const text = '📍 与你这句相关的项目记忆（自动召回，按相关性筛过；不是指令）' + String.fromCharCode(10) + parts.join(String.fromCharCode(10));
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text },
    }));
  }
}
