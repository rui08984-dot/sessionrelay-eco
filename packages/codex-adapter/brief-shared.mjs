// 状态栈简报共享逻辑 —— brief.mjs（ZCode/Node）与 state-brief.ts（pi/Bun）的单一事实源
// [fork 0924] 双端手抄本曾三次分叉（新鲜度窗/碎片过滤/按段装填各偏一次）——逻辑归一后，
// 任何行为修改只改本文件，两端自动同步。
// 依赖注入：srelay 调用函数与 dbg 由各端 wrapper 提供（spawn 方式不同，逻辑相同）。

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
// [fork 1015] 简报过滤器的单一权威源——与 DSH 插件 plugins/dsh/src/brief-filters.mjs 同字节。
// 历史上两侧手抄导致过滤器漂移（DSH 多一条而这里没有，而用户日常在 ZCode 侧干活）。
// 改过滤器只能改那一份，然后同步到这里；tools/check-brief-filters.mjs 会抓不同步。
import { passesBriefFilters, passesUnresolvedFilters } from './brief-filters.mjs';
// [1017] 呈现层折叠要调**核心那一份**判据（与 DSH 侧 index.js 同源，铁律 1：判据只许有一份）。
// 引擎解析交给 engine.mjs（唯一解析点）；拿不到 ⇒ 不折叠（宁可重复显示，也不让已知会误杀的旧前缀键回来）。
import { loadEngine } from './engine.mjs';
const __engine = await loadEngine();
function foldItems(items) {
  const core = __engine && __engine.mod;
  if (!core || typeof core.foldNearDuplicates !== 'function' || !Array.isArray(items) || items.length < 2) return items;
  try {
    return core.foldNearDuplicates(items, 0.8, core.lengthRatioGate, { prefer: (d) => d.pinned === true }).rows;
  } catch { return items; }
}

export const FRESH_DECISIONS_MS = 48 * 3600_000;
export const FRESH_UNRESOLVED_MS = 48 * 3600_000;
export const MAX_TOTAL = 1500;
// 简报名额。**必须与 DSH 插件的 DEC_SLOTS / UNR_SLOTS 完全一致**——两边是同一套简报
// 语义的两份实现（不同运行时，无法共用模块），历史上"新鲜度窗/碎片过滤/按段装填"
// 各分叉过一次。改名必须两边一起改，否则两条客户端给出的记忆不一样。
export const DEC_SLOTS = 4;
// [1017 夜 U-A 降级] UNR_SLOTS 3 → 1。依据 docs/research/2026-10-18-U-A未决段处置调研.md：
//   实测注入了 3 条，其中 2 条是残片（precision ≈ 1/3），而且 3 条**全部来自同一个老会话**
//   （该会话 7 条"未决"其后各有 305~524 条 assistant 消息 ⇒ 早被答过，"未决"与"未答"不相关）。
//   名额从 3 降到 1 是**降级**不是终态：配 7 天 precision 门禁，仍 <50% 就转"砍掉不渲染"。
//   反悔很简单 —— 把数字改回 3（**改内核 recall 那一处**，三运行时一起生效）。
//
// [1017 夜 12d 归核] 这里原来是自己写的 `export const UNR_SLOTS = 1`（第三份副本）。
//   判据收进内核 dist/recall.js 后改为转发权威值，物理消灭第三份。
//   brief-filters.mjs 拿不到引擎时退回 1（只影响「无内核」的裸装场景）。
export { UNR_SLOTS } from './brief-filters.mjs';
// ⚠️ [1021 修] **`export { X } from '...'` 只是「转出口」，不会创建本地绑定。**
//   本文件第 318 行 `slice(0, UNR_SLOTS)` 用的是**本地**引用，而它从 1017 夜那次「归核」起
//   就一直没被 import 过 ⇒ 每次执行到这里都抛 `ReferenceError: UNR_SLOTS is not defined`。
//   而 brief.mjs 的契约是「任何失败=空输出」（hook 规范要求不阻塞会话），于是
//   这个 ReferenceError 被彻底吞掉 —— **ZCode 侧的自动简报从那天起一条都没注入过**。
//   发现方式：`SRELAY_BRIEF_DEBUG=1` 跑一次才看见 stderr 里的这行。
import { UNR_SLOTS as UNR_SLOTS_LOCAL } from './brief-filters.mjs';
const UNR_SLOTS = UNR_SLOTS_LOCAL;
// 看板单行字符上限。实测（D:\agent1super）：progress.md 的明细列动辄 600+ 字符，
// 两行就占掉简报 91% 的预算（1313/1438），而真正的记忆内容——决策与未决——只拿到 5%。
// 看板是 progress.md 状态栈的东西，不是 SessionRelay 的记忆；它不该把 SES 唯一的
// 自动通道几乎全占。截断只动明细列，任务名/状态/备注三列完整保留。
export const KANBAN_ROW_CAP = 280;

// ── 过滤规则常量：与 plugins/dsh/index.js 的同名常量必须**逐字一致** ──
// 1015 实测两侧漂移过一次：DSH 的 itemsFromArray 比这里的 jsonItems 多一条
// "报告/审稿碎片"过滤，而用户日常在 ZCode 侧干活——缺的恰好是他唯一会看到的那一侧。
// 常量提到模块作用域就是为了让 tools/check-brief-filters.mjs 能逐字比对这两行；
// 过滤器链本身由同一个脚本断言"两侧都含同一条正则"。别再靠人眼对齐。
/** 闲聊会话名单：会话标题是纯打招呼/测试的，其决策与未解决条目都视为跨会话噪音（0926 实测 NSFW 闲聊自「你好」会话流入简报） */
export const CHATTER_TITLE = /^(你好|哈喽|您好|hi+|hello|hey|test|测试|在吗|在么)[!！。.~\s]*$/i;
// 子代理任务书标题（Phase 3 层①）。派给 subagent 的那条任务书，标题就是任务书原文。
// 实测这类会话贡献全部决策的 16.7%（D:\agent1super，90 会话 204 条）与 9.2%
// （E:\music player，28 会话 47 条），且**它们的报告永远比主会话的决策写入更晚**——
// 所以简报"取最新 N 条"必然取到它。1015 实测简报 4 条决策 4 条全来自同一个
// 红队子代理会话（标题="你是红队审查员。任务：…"，14 条消息里唯一实质内容是
// seq=98 那条 10521 字的审查报告，报告里引用的示例决策反被抽成拍板）。
// **只挡简报，不挡存储与检索**：信息零丢失，反悔只需删这一行过滤器。
// 判据故意收得很窄：实测扩到"请精读/帮我"会连主会话的真决策一起挡掉——那类标题的
// 会话里有"改用 fileURLToPath()"这种真决策（1015 实测，两个候选判据都试过）。
export const SUBAGENT_TASK_TITLE = /^(你是|你作为|任务[:：]|你的任务|act as|you are)/i;

// ── 「最近在动哪些文件」：1015 夜起与 DSH 侧同款（同一行、同一阈值、同一截断） ──
// 数据来自 `srelay brief --json` 的 recentFiles（核心库 listRecentFiles，与 DSH 插件的
// queryRecentFiles 同规；tools/_probe_brief_parity.mjs 在两个真实库上对拍逐字段相同）。
// ⚠️ 不要在这里加「/N 条决策」：那个数是**这些会话的决策总数**，同一批会话里的文件必然同值，
//    而「决策文本含文件名」的口径实测 18/18 全为 0——两个口径都没有判别力。全表见
//    docs/1015-深夜-最近在动-信号体检.md。
export const RECENT_TOP = 3;

/** [1016] 🌍 经验段：核心库已过两道闸与预算；这里**只做渲染**，空数组就整段不出现 */
export function experiencesLine(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const body = rows.map((r) => String(r.text || '')).filter(Boolean).join('；');
  return body ? '🌍 经验：' + body : '';
}

/**
 * 🌿 Git 脏状态一行（[B5]，2026-10-16）—— 与 DSH 插件 `plugins/dsh/index.js` 的 gitStatusText 同规。
 *
 * 为什么值得占预算：模型看不到工作区状态时会把"已经改了一半的东西"当成不存在，
 * 典型症状是它让你"先写 X"，而 X 其实早就写完、只差提交。
 * 为什么这里可以同步起子进程：本函数只跑在 **SessionStart**（一次性），不在每轮注入的路径上；
 * 每轮的那个 hook（brief-turn.mjs）**绝不**起子进程，这条线不许越。
 * 失败一律静默（不是 git 仓库 / 没装 git / 超时 → 空串，整行不出现）。
 */
export function gitStatusLine(root) {
  try {
    // -c core.quotepath=false：否则中文文件名会被转义成 \345\233\276 这种八进制
    const out = execFileSync('git', ['-c', 'core.quotepath=false', '-C', root, 'status', '--porcelain=v1', '--branch'],
      { timeout: 1500, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    const lines = String(out || '').split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return null;
    const head = lines[0].startsWith('##') ? lines[0].slice(2).trim() : '';
    const br = /^([^\s.]+)/.exec(head)?.[1] ?? '';
    const gap = /\[([^\]]+)\]/.exec(head)?.[1] ?? '';
    const files = lines.slice(1);
    if (!br && files.length === 0) return null;
    const names = files.slice(0, 3).map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).map((n) => (n.length > 28 ? '…' + n.slice(-26) : n));
    const more = files.length > names.length ? ` 等 ${files.length} 个` : '';
    const body = files.length === 0 ? '工作区干净' : `${files.length} 个未提交：${names.join('、')}${more}`;
    return `🌿 Git：${br}${gap ? ' ' + gap : ''} · ${body}`;
  } catch { return null }
}

export function recentFilesLine(rows) {
  const list = Array.isArray(rows)
    ? rows.filter((x) => x && typeof x.file === 'string' && x.file.length >= 4).slice(0, RECENT_TOP)
    : [];
  if (!list.length) return null;
  const body = list.map((x) => {
    const name = x.file.length > 42 ? '…' + x.file.slice(-40) : x.file;
    return `${name}（${Number(x.sessions) || 0} 场）`;
  }).join('｜');
  return '🗂 近 7 天反复在动：' + body;
}

// [1015 夜 · 排版] 标点在边界截断（与 DSH 侧同规则）：硬切会造出「…· 严」这种半截词。
function clipAt(s, max) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  const w = t.slice(0, max);
  const i = Math.max(w.lastIndexOf('。'), w.lastIndexOf('；'), w.lastIndexOf('，'), w.lastIndexOf('、'), w.lastIndexOf('：'), w.lastIndexOf(' '));
  return (i >= max * 0.6 ? w.slice(0, i) : w) + '…';
}

export function kanbanLines(root, dbg) {
  const p = join(root, 'progress.md');
  if (!existsSync(p)) return null;
  if (statSync(p).size > 1048576) {
    if (dbg) console.error('[statebrief] progress.md >1MB, 跳过看板解析');
    return null;
  }
  try {
    const lines = readFileSync(p, 'utf8').split(/\r?\n/);
    const updated = (lines.find((l) => l.startsWith('> 最后更新'))?.match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0] ?? '';
    const rows = lines
      .map((l) => l.split('|').map((s) => s.trim()))
      .filter((c) => c.length >= 5 && /^[✅🔄⛔⬜]/u.test(c[2] ?? '') && /[🔄⛔]/u.test(c[2] ?? ''))
      .map((c) => {
        const head = `| ${c[1]} | ${c[2]} | ${c[3] ?? '—'} | `;
        const detail = c[4] ?? '';
        const room = KANBAN_ROW_CAP - head.length - 2;
        return room > 24 && detail.length > room ? `${head}${clipAt(detail, room)} |` : `${head}${detail} |`;
      })
      .slice(0, 5);
    if (!rows.length) return null;
    return `看板(progress.md${updated ? ' ' + updated : ''})进行中/阻塞:\n${rows.join('\n')}`;
  } catch (e) {
    if (dbg) console.error('[statebrief] kanban:', e?.message ?? e);
    return null;
  }
}

function jsonItems(raw, key, max, maxAgeMs) {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    const arr = j[key] ?? j.unresolved ?? [];
    // 新鲜度窗：决策/未解决均 48h，更老的全量查不上简报
    const cutoff = Date.now() - maxAgeMs;
    // 决策条目带 text，未决问题带 q（--json 与直查 SQL 两种取数都是这个形状）。
    // 过滤器与末尾渲染必须走同一个取值函数——否则过滤器看不见未决的正文，
    // 整条通道会被静默清空（1015 实测：主库 43 条未决全被 length<5 拦掉）。
    const textOf = (d) => String(d.text ?? d.summary ?? d.q ?? d.title ?? '');
    const fresh = arr
      // ── 1020 · P1：压缩卡片机制（压缩不掉召回）──
      //   L3 压缩写回后原始条目带 `compressed_into`，同时追加了卡片。
      //   **简报跳过带标记的**，**检索不跳**。与核心 collectBrief / DSH brief-sql 同一判据。
      .filter((d) => !d.compressed_into)
      // 碎片过滤：施工会话碎片出现在 title 或 text（title 干净、text 半句的组合实测存在）
      .filter((d) => !/workflow subagent|actor#\d+/i.test(String(d.title ?? '') + ' ' + textOf(d)))
      // 粘包过滤：多条消息拼进一条记录（"？,-"接缝）= 采集伪影，决策/未解决两通道都拦
      .filter((d) => !/[??？]\s*,\s*[-–]/.test(textOf(d)))
      // 闲聊标题过滤：会话名为纯打招呼/测试的条目不进简报（依赖 --json 的 title 字段，缺字段时自然放行）
      .filter((d) => !CHATTER_TITLE.test(String(d.title ?? '').trim()))
      // 决策陈述句过滤（仅 decisions；未解决本来就是问句不能拦问号）：问号结尾/口语疑问模式不进简报
      .filter((d) => { if (key !== 'decisions') return true; const t = textOf(d); return !/[??？]\s*$/.test(t) && !/怎么办|能不能|怎么说|是不是|要不要|原理是什么/.test(t); })
      // 报告/审稿碎片过滤：粘贴进来的审查报告段落，其开头词与元话语词都不是用户的决策。
      // 1015 才发现这条**只有 DSH 侧有、这里没有**——而用户日常在 ZCode 侧干活，
      // 缺的恰好是他唯一会看到的那一侧。实测它对本轮 4 条噪声只能拦住 1 条，
      // 是必要条件远不是充分条件，所以下面还有层①。
      .filter((d) => {
        const t = textOf(d);
        return !/^(报告|原文|上文|上述|文档|该文|这篇|那份)/.test(t.trim())
          && !/被当成|误命中|被判为|不是决策|纯垃圾|噪声|伪影/.test(t);
      })
      // [fork 1015] 七条规范过滤器（brief-filters.mjs 单一权威源，与 DSH 侧同源）。
      // 实测：主库只拦 6/1172、音乐库 5/490，全部是噪声、0 误杀，且正好覆盖
      // Phase 3 治不掉的 3 条散文噪声（决定用 X"/作者点名表扬/按你在 Notes 里提议）。
      .filter((d) => passesBriefFilters(textOf(d)))
      // [1015 夜 U-A] 未决段专用过滤（与 DSH 侧同规；四条见 brief-filters.mjs）
      .filter((d) => (key === 'decisions' || d.pinned === true) ? true : passesUnresolvedFilters(textOf(d)))
      // Phase 3 层①：子代理任务书会话的决策/未决不进简报（仍全量可检索）。
      // 置顶豁免——用户显式 pin 过的东西要尊重，与上面新鲜度窗同一规矩。
      .filter((d) => {
        if (d.pinned === true) return true;
        return !SUBAGENT_TASK_TITLE.test(String(d.title ?? '').trim());
      })
      // 新鲜度窗：决策/未解决均 48h，更老的全量查不上简报——置顶条目豁免：
      // 置顶的意义就是"重要的老决策也要进简报"，再被 48h 窗滤掉就自相矛盾了
      .filter((d) => {
        if (d.pinned === true) return true;
        const at = Date.parse(d.at ?? d.msgAt ?? '');
        return !Number.isFinite(at) || at >= cutoff;
      });
    // 按时间倒序取最新 max 条（srelay 各 API 的排序语义不同，这里显式定序）；
    // 置顶优先：pinned 排最前（同组内仍按时间倒序）——简报只留 2 条，
    // 用户 pin 住的重要老决策必须挤掉今天的琐碎决策
    fresh.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (Date.parse(b.at ?? b.msgAt ?? '') || 0) - (Date.parse(a.at ?? a.msgAt ?? '') || 0);
    });
    // [1017] 近重复合并（只在显示层，不动存储/检索）——判据换成**核心那一份**：
    // foldNearDuplicates（二元组重叠 + 长度比门 + 置顶优先），取代原先自建的"前 14 字前缀键"。
    // 病历：前缀键误杀过干净决策「采用 Vite 作为前端构建工具」，留下 62 字粘连噪声（长度比 3.88）。
    // 与 DSH 侧同源 ⇒ 两侧简报不会再因为各写一套判据而分叉。
    const deduped = foldItems(fresh);
    return deduped
      .slice(0, max)
      // 字段链按各 API 真实 schema：decisions={text}, unresolved={q}——缺 q 曾静默显示会话标题
      // 决策带日期（与 DSH 侧同规）：改过主意时一眼看出哪条新哪条旧。未决不带，省 token。
      // ADR-001：否定性决策加 ✗（与 DSH index.js 同规）。"改用 Y"与"采用 Y"此前在简报里
      // 长得一样，模型看不出 Y 是被否掉的那条路，同一建议会被反复重提。
      .map((d) => {
        const text = clipAt(textOf(d), 90);   // [1015 夜] 标点边界截断
        const mark = (key === 'decisions' && d.kind === 'negative') ? '✗ ' : '';
        if (key !== 'decisions') return `- ${text}`;
        const at = Date.parse(d.at ?? d.msgAt ?? '');
        if (!Number.isFinite(at)) return `- ${mark}${text}`;
        return `- [${new Date(at).toISOString().slice(5, 10)}] ${mark}${text}`;
      });
  } catch {
    // 文本兜底：仅解析失败时触达（unresolved --json 0.5.x 空时输出人话）
    const clean = raw
      .replace(/\[[0-9;]*m/g, '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('（') && !s.startsWith('('));
    if (!clean.length || /暂无/.test(raw)) return [];
    return clean.slice(0, max).map((s) => `- ${s.slice(0, 90)}`);
  }
}

/** 从 srelay --json 输出里取条数（复用已取到的原始串，不新增子进程——低延迟是硬约束） */
function jsonCount(raw, key) {
  try { const j = JSON.parse(raw); const n = j.count ?? (Array.isArray(j[key]) ? j[key].length : 0); return Number(n) || 0; } catch { return 0; }
}

/**
 * 取数：**优先一次子进程**（`srelay brief --json`），老 CLI 没有该命令时回落到两次。
 * 为什么值得合并：实测每次 spawn 175–203ms，两次 = 每轮固定烧掉约 380ms；
 * 合并成一次后实测省 164–205ms（−43%~−52%），同时白得 recentFiles 那一行。
 * 回落路径与改造前**逐字节一致**（decRaw/unrRaw 就是原来那两条命令的原始输出），
 * 所以「装的是旧 CLI」这种情形不会让简报变样，只是慢一点、少一行。
 */
function fetchBriefFeed(srelay, dbg) {
  try {
    const raw = srelay(['brief', '--limit', '200', '--json']);
    const j = raw ? JSON.parse(raw) : null;
    if (j && Array.isArray(j.decisions) && Array.isArray(j.unresolved)) {
      return {
        decRaw: JSON.stringify({ decisions: j.decisions }),
        unrRaw: JSON.stringify({ unresolved: j.unresolved }),
        counts: {
          decisions: Number(j.counts?.decisions ?? j.decisions.length) || 0,
          unresolved: Number(j.counts?.unresolved ?? j.unresolved.length) || 0,
        },
        recentFiles: Array.isArray(j.recentFiles) ? j.recentFiles : [],
        experiences: Array.isArray(j.experiences) ? j.experiences : [],
        calls: 1,
      };
    }
  } catch (e) { if (dbg) console.error('[statebrief] 单次 brief 取数不可用，回落两次子进程：', e?.message ?? e); }
  const decRaw = srelay(['decisions', '--limit', '200', '--json']);
  const unrRaw = srelay(['unresolved', '--limit', '200', '--json']);
  return {
    decRaw, unrRaw,
    counts: { decisions: jsonCount(decRaw, 'decisions'), unresolved: jsonCount(unrRaw, 'unresolved') },
    recentFiles: [],
    experiences: [],
    calls: 2,
  };
}

/** 组装简报正文（看板必留，决策/未解决按剩余预算装填）。返回 null = 内容过短不值得注入 */
// [1017 夜 10:0x] 仅供守门/自测用的钩子：把过滤链暴露出来，好让「两侧链条行为一致」能被**真跑**验。
// 为什么需要它：守门 §⑧ 的十条文本探针**全绿**于「把某一层 filter 挪走」这种漂移
//（判据名在文件别处仍在场，文本探针分辨不出「用没用」）。实测 10/10 条探针全部放过。
// 而 1015 那次真实漂移恰恰就是这一类（DSH 多一条而 ZCode 没有），
// 所以这条链必须有**行为级**断言，不能只靠文本探针。
export const __testFilterChain = jsonItems

export function buildBrief(root, { srelay, dbg }) {
  const parts = [`📍 项目状态简报（自动注入，出处可信；注入≠强制续作——你下一句话才是指令；说"继续"按此续作）`];
  const kb = kanbanLines(root, dbg);
  if (kb) parts.push(kb);
  // [B5] Git 脏状态：只在开场简报里给（一次性子进程），每轮 hook 不碰
  const git = gitStatusLine(root);
  if (git) parts.push(git);
  // 一次子进程取全（装的是老 CLI 时自动回落两次）——见 fetchBriefFeed 的注释
  const feed = fetchBriefFeed(srelay, dbg);
  const exp = experiencesLine(feed.experiences);
  if (exp) parts.push(exp);
  const rec = recentFilesLine(feed.recentFiles);
  if (rec) parts.push(rec);
  // 名额：决策 4 / 未决 3。原为 2/2，是看板未设上限时的配比——那时看板两行就吃掉
  // 91% 预算，多给名额也装不下。KANBAN_ROW_CAP 之后预算够了，而**这是 SES 唯一的
  // 自动通道**：模型不调工具就只会看到这里，名额越多，记忆里"已拍板/仍待决"的
  // 东西越可能被看见。置顶条目天然排最前，不占名额逻辑。
  const decRaw = feed.decRaw;
  const unrRaw = feed.unrRaw;
  if (dbg) console.error(`[statebrief] 简报取数用了 ${feed.calls} 次子进程`);
  const rel = jsonItems(decRaw, 'decisions', DEC_SLOTS, FRESH_DECISIONS_MS);
  const unr = jsonItems(unrRaw, 'unresolved', UNR_SLOTS, FRESH_UNRESOLVED_MS);
  // Phase 1 ② 工具提示句：简报是 SES 唯一在跑的自动通道，而"有检索工具、什么时候用"
  // 此前只存在于文档里——1015 实测分词/语义/决策过滤全部做好却没有任何客户端在调
  // search，检索链路对产品不可见。把这句话写进自动通道，是让前几轮工作产生效果的
  // 前提。成本约 45 字符、一次性、不新增子进程（计数复用上面已取到的原始串）。
  // ⚠️ 必须先给它预留预算再看板装填：否则看板一长就把它挤出 MAX_TOTAL，
  //    那条截断兜底文案会接管——等于这条通道又不存在了。
  const toolHint = `🔎 细节/出处用 srelay_search 检索（本项目 ${feed.counts.decisions} 条决策 · ${feed.counts.unresolved} 条未决可查）`;
  let budget = MAX_TOTAL - parts.join('\n').length - 2 - toolHint.length;
  if (rel && budget > 120) {
    const seg = rel.length > budget ? rel.slice(0, budget) + '…' : rel;
    // [fork 1014] 必须 join 成字符串再 push：数组进 parts 后，外层 join('')
    // 会把数组元素用逗号连接，产出 "- 问题一？,- 问题二？" 这种粘包显示。
    // DSH 插件侧用换行符连接所以没这问题，两侧对齐。
    parts.push(seg.join('\n'));
    budget -= seg.join('\n').length;
  }
  if (unr && budget > 80) parts.push((unr.length > budget ? unr.slice(0, budget) + '…' : unr).join('\n'));
  // 提示句固定收尾：放在最后，读起来是"下一步该干什么"；预算已预留，不会被截断
  parts.push(toolHint);
  const ctx = parts.join('\n');
  if (ctx.length > MAX_TOTAL) return ctx.slice(0, MAX_TOTAL) + '\n…(截断，细节 srelay search)';
  if (ctx.length > 60) return ctx;
  return null;
}
