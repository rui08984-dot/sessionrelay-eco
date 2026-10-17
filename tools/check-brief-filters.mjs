#!/usr/bin/env node
// check-brief-filters.mjs — 两侧简报过滤器一致性守门（常驻工具，勿删）
//
// 为什么需要它：ZCode 侧（~/.zcode/hooks/statebrief/brief-shared.mjs）与 DSH 插件侧
// （plugins/dsh/index.js）是**同一套简报语义的两份实现**——不同运行时、无法共用模块，
// 只能手抄。本项目"同一处知识不许有多份副本"在这两处反复被咬：
//   · 0924 新鲜度窗/碎片过滤/按段装填各分叉过一次
//   · 1014 简报名额三处副本只改到两处（DEC_SLOTS/UNR_SLOTS 收敛）
//   · 1015 过滤器漂移：DSH 的 itemsFromArray 有"报告/审稿碎片"过滤，
//     ZCode 的 jsonItems 没有——而用户日常在 ZCode 侧干活，
//     缺的恰好是他唯一会看到的那一侧。症状是简报噪声，无任何报错。
//
// 检查两项（任一不过非零退出）：
//   ① 两个常量 CHATTER_TITLE / SUBAGENT_TASK_TITLE 的**正则源串逐字相同**
//   ② 每条规范过滤器正则在两侧文件里都出现（防"一侧有一条另一侧没有"）
//
// 用法：node tools/check-brief-filters.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.dirname(HERE);
const ZCODE = 'C:/Users/crx/.zcode/hooks/statebrief/brief-shared.mjs';
const DSH = path.join(WS, 'plugins', 'dsh', 'index.js');

let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  🔴 ${m}`); fail++; };

function read(p) {
  try { return readFileSync(p, 'utf8'); }
  catch (e) { bad(`读不到 ${p}: ${e.message}`); return ''; }
}
const z = read(ZCODE), d = read(DSH);
if (!z || !d) { console.log('\n🔴 文件缺失，无法比对'); process.exit(1); }

console.log('══════ ① 常量正则源串逐字相同 ══════');
for (const name of ['CHATTER_TITLE', 'SUBAGENT_TASK_TITLE']) {
  const grab = (src) => {
    const m = src.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(/[^\\n]*?/\\w*)`));
    return m ? m[1] : null;
  };
  const zv = grab(z), dv = grab(d);
  if (!zv || !dv) { bad(`${name} 一侧缺失（ZCode=${!!zv} DSH=${!!dv}）`); continue; }
  if (zv === dv) ok(`${name} 两侧逐字相同：${zv}`);
  else bad(`${name} 不一致\n       ZCode: ${zv}\n       DSH : ${dv}`);
}

console.log('\n══════ ② 规范过滤器正则在两侧都在场 ══════');
// 每条都是"两侧必须同时有"的过滤器。加新过滤器时往这里加一行。
const CANONICAL = [
  ['施工会话碎片', /workflow subagent\|actor#/],
  ['粘包伪影', /\[\?\?？\]\\s\*,\\s\*\[-–\]/],
  ['闲聊标题', /CHATTER_TITLE/],
  ['子代理任务书', /SUBAGENT_TASK_TITLE/],
  ['决策陈述句（问号/口语疑问）', /怎么办\|能不能\|怎么说\|是不是\|要不要\|原理是什么/],
  ['报告/审稿碎片', /被当成\|误命中\|被判为\|不是决策\|纯垃圾\|噪声\|伪影/],
  ['置顶豁免新鲜度窗', /pinned === true/],
];
for (const [label, re] of CANONICAL) {
  const inZ = re.test(z), inD = re.test(d);
  if (inZ && inD) ok(`${label}：两侧都在场`);
  else bad(`${label}：只在${inZ ? 'ZCode' : 'DSH'}侧有${inZ ? '' : '，ZCode 缺'}${inD ? '' : '，DSH 缺'}`);
}

console.log('\n══════ ③ 简报名额一致 ══════');
// 只比两侧都有的东西。看板是 **ZCode 独有**的（DSH 侧不注入 progress.md，只看记忆段），
// 所以 KANBAN_ROW_CAP（ZCode 单行截断）与 MAX_CHARS（DSH 总长上限）不是同一概念、
// 不该相等——1015 第一版守门把这个错了配成一对，报了个假红。两边各自的语义：
//   ZCode KANBAN_ROW_CAP=280 → progress.md 明细列单行截断
//   DSH   MAX_CHARS=1200     → DSH 简报正文总长上限（无看板，故只需要总上限）
const grabNum = (src, name) => {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
};
for (const name of ['DEC_SLOTS', 'UNR_SLOTS']) {
  const zv = grabNum(z, name), dv = grabNum(d, name);
  if (zv === null || dv === null) { bad(`${name} 一侧缺失（ZCode=${zv} DSH=${dv}）`); continue; }
  if (zv === dv) ok(`${name} 两侧一致 = ${zv}`);
  else bad(`${name} 不一致：ZCode=${zv} DSH=${dv}`);
}
const zRowCap = grabNum(z, 'KANBAN_ROW_CAP');
const dMax = grabNum(d, 'MAX_CHARS');
ok(`ZCode 看板单行上限 KANBAN_ROW_CAP=${zRowCap}（DSH 无看板，不参与比对）`);
ok(`DSH 简报总长上限 MAX_CHARS=${dMax}（ZCode 用 MAX_TOTAL=${grabNum(z, 'MAX_TOTAL')}）`);
if (zRowCap === null || dMax === null) bad('单行上限/总长上限一侧读不到，请人工确认');

console.log('\n══════ ④ brief-filters.mjs 两侧一致性 ══════');
//
// [1017 夜 12d 归核时改过，**被独立复审判为覆盖净损失，已回退并加强**——把这次教训原样记在这里：
//
//   当时我以为「归核后两侧不再同字节（DSH 走 ../vendor/dist/recall.js、ZCode 走 ./engine.mjs，
//   import 路径不同），所以 md5 判据失效」——**前半句对，后半句的结论错**：
//   import 路径不同是**运行时**事实，而两侧**源码**仍然是同一份文件（都从作者副本同步过去），
//   md5 完全能比。把它换成「只比 BRIEF_CANONICAL_FILTERS 数组体」造成三处覆盖损失：
//     ① **两侧同时改则永远看不见**（只比「彼此相等」，两侧一起把七条删成六条照样绿）；
//        而「两侧同改」恰恰是纪律「同一判据只有一份」最该防的场景。
//     ② 规范化 `replace(/\/\/[^\n]*/g,'')` 会**整条吃掉含 // 的正则**（如 /https?:\/\/[^\s]+/），
//        两侧同插一条这样的过滤器仍绿 ⇒ 打印出的「327 字符」不是可信指纹。
//     ③ **本轮归核的标的 UNRESOLVED_FILTERS 恰好落在数组体之外**，失去逐字节守卫。
//   ⇒ 回退：全文 md5 恢复为**主判据**，数组体比对降级为**附加的可读信息**（且注释里写明它会漏什么）。
{
  const crypto = await import('node:crypto');
  const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
  const AUTH = path.join(WS, 'plugins', 'dsh', 'src', 'brief-filters.mjs');
  const ZC = 'C:/Users/crx/.zcode/hooks/statebrief/brief-filters.mjs';
  try {
    // 归核后两侧**故意不同字节**（DSH 走 ../vendor/dist/recall.js，ZCode 走 ./engine.mjs），
    //   所以全文 md5 不能作判据；§④ 第一版改比数组体，又被复审判为覆盖净损失（两侧同改看不见）。
    //
    // 终态判据：**只剔除「引擎加载块」再比全文**。那块用两个稳定的语义锚点定位，
    //   而不是逐行正则 —— 上一个版本用行首正则漏掉了多行语句与注释，实测两边仍差 10 行。
    //   锚点两端都用**稳定的代码标记**，不用注释文字：
    //     起点 = 最后一次出现 `12d 归核` 的那一行往前退到该注释块的空行（两侧这段注释文字本就不同）；
    //            实测用「未决段判据实际来自内核」当起点，在 DSH 侧会多切 7 行（那边 JSDoc 在上一行）。
    //     终点 = `export function passesUnresolvedFilters`（函数体开始）。
    //   块外的（七条规范过滤器、未决段四条正则、两个常量、兜底实现本体）必须逐字节相同 ⇒
    //   **两侧同时改未决段判据照样会被抓到**（那正是本轮归核的标的），堵掉复审 S1-①。
    const ENGINE_BLOCK_START = '12d 归核';
    const ENGINE_BLOCK_END = 'export function passesUnresolvedFilters';
    const stripEngineBlock = (src) => {
      const lines = src.split('\n');
      let s = -1;
      for (let i = 0; i < lines.length; i++) if (lines[i].includes(ENGINE_BLOCK_START)) s = i;
      // 从注释块起点回退到最近的空行，两侧注释文字不同但边界结构相同
      while (s > 0 && lines[s - 1].trim() !== '') s--;
      const e = lines.findIndex((l) => l.includes(ENGINE_BLOCK_END));
      if (s < 0 || e < 0 || e <= s) return { text: src, ok: false };
      return { text: lines.slice(0, s).concat(['<<<ENGINE-BLOCK>>>'], lines.slice(e)).join('\n'), ok: true };
    };
    const sa = stripEngineBlock(readFileSync(AUTH, 'utf8'));
    const sz = stripEngineBlock(readFileSync(ZC, 'utf8'));
    if (!sa.ok || !sz.ok) {
      bad('④ 定位引擎加载块的锚点变了（找不到起点/终点）—— 守门需要跟着改，否则这一节等于没跑');
    } else {
      const ha = md5(sa.text), hz = md5(sz.text);
      if (ha === hz) ok(`brief-filters.mjs 两侧除引擎加载块外同字节（md5 ${ha.slice(0, 12)}）—— 覆盖七条 + 未决段四条正则 + 两个常量`);
      else bad(`brief-filters.mjs 两侧不同步（剔除引擎加载块后仍不同）！\n       权威源: ${ha}\n       ZCode侧: ${hz}\n       判据只有一份：改作者副本后跑 node integrations/zcode/install.mjs --apply`);
    }
    // ⚠️ 上面那条**只是两侧互比**，抓不到「两侧同改」——这是复审 S1-① 实测的假绿。
    //   所以下面必须再有一条**三方比对**：拿**核心仓那份**当独立第三方。
    //   核心不经过 ZCode 同步链 ⇒ 两侧一起改时它不变，差异就暴露了。
    //   （实测：两侧同时删掉未决段第 2 条正则，本节 ✅ 绿，而三方比对当场报 3 vs 4 条不一致。）
    const CORE_FILTERS = path.join(WS, 'core', 'SessionRelay', 'src', 'cli', 'brief-filter.ts');
    const rulesOf = (src, name) => {
      const L = src.split('\n');
      const s = L.findIndex((l) => l.includes('const ' + name));
      if (s < 0) return null;
      const out = [];
      for (let i = s; i < Math.min(L.length, s + 40); i++) {
        const body = L[i].trim();
        if (body.startsWith('//') || body.startsWith('*')) continue;
        if (body.startsWith('/')) out.push(body.replace(/,\s*$/, '').replace(/;\s*$/, ''));
        if (body.startsWith(']')) break;
      }
      return out;
    };
    try {
      const ra = rulesOf(readFileSync(AUTH, 'utf8'), 'UNRESOLVED_FILTERS');
      const rz = rulesOf(readFileSync(ZC, 'utf8'), 'UNRESOLVED_FILTERS');
      const rc = rulesOf(readFileSync(CORE_FILTERS, 'utf8'), 'UNRESOLVED_FILTERS');
      if (!ra || !rz || !rc) console.log('  ⚠️ 三方比对抽不到未决段四条正则（某侧格式变了）——请人工确认');
      else {
        const n = Math.max(ra.length, rz.length, rc.length);
        const diff = [];
        for (let i = 0; i < n; i++) if (ra[i] !== rc[i] || rz[i] !== rc[i]) diff.push(i + 1);
        diff.length === 0
          ? ok(`未决段四条正则**三方**一致（DSH=${ra.length} ZCode=${rz.length} 核心=${rc.length}）——两侧同改也抓得到`)
          : bad(`未决段四条正则三方不一致：第 ${diff.join('、')} 条与核心对不上\n       两侧同改时这条才会红（核心是独立第三方）`);
      }
    } catch (e) { bad('三方比对失败: ' + (e?.message ?? e)); }
  } catch (e) {
    bad(`读 brief-filters.mjs 失败: ${e.message}`);
  }
}

// ══════ ⑤ ADR-002 影子谓词（**只记录不生效**，但必须两侧在场且行为正确）══════
// 为什么守它：ADR 要求「新正则进 check-brief-filters 断言范围」。影子期它不参与过滤，
// 所以**没有其它任何东西会用到它**——一旦谁把它删了/改坏，不会有症状，直到将来接线时才炸。
// 断言双向：该命中的四类任务书标题要命中，正常标题一条都不许命中（否则接线时就是误杀）。
console.log('\n══════ ⑤ ADR-002 影子谓词（不生效）══════');
try {
  const dshF = await import(pathToFileURL(path.join(path.dirname(DSH), 'src/brief-filters.mjs')).href);
  const ZCDIR = 'C:/Users/crx/.zcode/hooks/statebrief';   // 上一段的 ZC 是块作用域，这里自带一份
  const zcF = await import(pathToFileURL(path.join(ZCDIR, 'brief-filters.mjs')).href);
  const haveBoth = typeof dshF.purposeShadowMatch === 'function' && typeof zcF.purposeShadowMatch === 'function';
  haveBoth ? ok('两侧都导出 purposeShadowMatch') : bad('影子谓词缺失（一侧或两侧）');
  const POS = [
    ['# 任务：对 SessionRelay 做对抗性审查', 'md-heading-task'],
    ['你在 Windows 11 (Git Bash) 环境排查 DeepSeek Harness', 'you-in-env'],
    ['只读探索。目标：判定推演沙盘能否落地', 'readonly-explore-goal'],
    ['今天是 2026-10-06。任务：为本地大模型接入做选型', 'today-task'],
  ];
  const NEG = ['你是红队审查员。任务：…', '项目地址：https://github.com/T-Auto/dsh-ops', 'D:\\dsh插件  记忆\\docs\\HANDOFF-MASTER-20261015.md', '嗯呃那个看一下这份文件里面有好几个目录吧'];
  if (haveBoth) {
    for (const [t, want] of POS) {
      const got = dshF.purposeShadowMatch(t);
      got === want ? ok(`命中 ${want}`) : bad(`应命中 ${want} 实得 ${got}：「${t.slice(0, 24)}」`);
    }
    const wrong = NEG.filter((t) => dshF.purposeShadowMatch(t) !== null);
    wrong.length === 0 ? ok(`正常标题 ${NEG.length} 条一条未误命中`) : bad(`误命中正常标题：${wrong.join(' ／ ')}`);
  }
} catch (e) { bad('影子谓词检查失败: ' + (e?.message ?? e)); }

// ── 未决段过滤器的**共享样本表**（⑤ 单实现行为 + ⑥ 双实现对拍，共用同一批，免得样本漂移）──
const UNR_KILL = [
  ['seq] --> L1[L1: 零拷贝语篇块剥离 Block-AST]', '图形残片'],
  ['呢他写了一份这个呃就是我给上游AI审计我们所有方案的一份md文件还是什么的', '口语转写'],
  ['并按现有路线推进 Phase 1/2/4？', '从句残片'],
  ['x'.repeat(90), '截断残片（90 字且无句末标点）'],
  ['```bash 这行到底怎么装？', '代码围栏'],
  ['subgraph 记忆层', 'Mermaid 头行'],
  // [1017 夜 U-A] 实测从生产简报里读到的残片原文（agent1super 注入 3 条里的 1 条）
  ['怎么样呢？', '短残片（实义字 0）'],
  ['还有呢？', '短残片（实义字 2）'],
];
const UNR_KEEP = ['那一边的测试集怎么样了？', '呢思考预算还有一些细致的调节的是什么参数？', '后续还能增加什么？', '为什么模型只有那个3.8flash？', '所以现在到底该用哪个判据？'];

// ══════ ⑤ 未决段专用过滤器（U-A）══════
// 断言双向：四类噪声必须被拦 + 两条**差点被误杀的真问题**必须放行（第一版规则就是死在这两条上）。
console.log('\n══════ ⑥ 未决段过滤器（U-A）══════');
try {
  const dshF2 = await import(pathToFileURL(path.join(path.dirname(DSH), 'src/brief-filters.mjs')).href);
  const ZCDIR2 = 'C:/Users/crx/.zcode/hooks/statebrief';
  const zcF2 = await import(pathToFileURL(path.join(ZCDIR2, 'brief-filters.mjs')).href);
  const both = typeof dshF2.passesUnresolvedFilters === 'function' && typeof zcF2.passesUnresolvedFilters === 'function';
  both ? ok('两侧都导出 passesUnresolvedFilters') : bad('未决过滤器缺失（一侧或两侧）');
  if (both) {
    const KILL = UNR_KILL;
    for (const [q, why] of KILL) {
      dshF2.passesUnresolvedFilters(q) === false ? ok(`拦掉 ${why}`) : bad(`应拦未拦（${why}）：${q.slice(0, 24)}`);
    }
    // 红队反例必须在两侧都放行（v1 就是死在这条上）
    const KEEP = UNR_KEEP;
    const killed = KEEP.filter((q) => !dshF2.passesUnresolvedFilters(q));
    killed.length === 0 ? ok(`真问题 ${KEEP.length} 条一条未误杀`) : bad(`误杀真问题：${killed.join(' ／ ')}`);
  }
} catch (e) { bad('未决过滤器检查失败: ' + (e?.message ?? e)); }

// ══════ ⑥ 未决过滤器 · **三运行时同源**（12d 归核后的终态检查）══════
// [1017 夜 12d] 原来这一节是「核心库 ⇄ 工作区插件」两份实现的行为对拍，理由是两个仓物理上
// 无法共用模块。**那个理由已经不存在了**：判据已收进核心 dist/recall.js 的导出面，
// 三个运行时（核心 CLI / DSH 插件 / ZCode hook）现在都 import 同一份。
//
// 所以本节从「两份实现对拍」升级为「**断言三侧真的都在走内核那份**」——
// 光对拍不够：只要有一侧悄悄退回本地兜底，判决照样一致（因为本地兜底与内核同判据），
// 但「同一处知识只有一份」已经破了，而且将来内核改了那一侧不会跟着改。
console.log('\n══════ ⑦ 未决过滤器 · 三运行时同源（走内核权威判据）══════');
try {
  const CORE_RECALL = path.join(WS, 'core', 'SessionRelay', 'dist', 'recall.js');
  const core = await import(pathToFileURL(CORE_RECALL).href);
  if (typeof core.passesUnresolvedFilters !== 'function') {
    bad('核心 recall.js 没有导出 passesUnresolvedFilters（先在 core/SessionRelay 跑 npm run build）');
  } else {
    const dshF = await import(pathToFileURL(path.join(path.dirname(DSH), 'src/brief-filters.mjs')).href);
    const zcF = await import(pathToFileURL('C:/Users/crx/.zcode/hooks/statebrief/brief-filters.mjs').href);
    // ① 两侧必须**自报**在走内核
    dshF.__unresolvedFromRecall === true
      ? ok('DSH 插件侧的未决判据来自内核 recall.js')
      : bad('DSH 插件侧未走内核（__unresolvedFromRecall=false）—— 已退回本地兜底，判据又变成两份了');
    zcF.__unresolvedFromRecall === true
      ? ok('ZCode 侧的未决判据来自内核 recall.js')
      : bad('ZCode 侧未走内核（__unresolvedFromRecall=false）—— 已退回本地兜底，判据又变成两份了');
    // ①b 七条也必须自报在走内核（1018 收进内核后新增；此前它是「只参照」的抄本，
    //     守门只能证「两侧一致」、证不了「两侧都对」—— 两边一起改错照样绿）
    dshF.__briefFromRecall === true
      ? ok('DSH 插件侧的七条规范过滤器来自内核 recall.js')
      : bad('DSH 插件侧七条未走内核（__briefFromRecall=false）—— 已退回本地兜底，判据又变成两份了');
    zcF.__briefFromRecall === true
      ? ok('ZCode 侧的七条规范过滤器来自内核 recall.js')
      : bad('ZCode 侧七条未走内核（__briefFromRecall=false）—— 已退回本地兜底，判据又变成两份了');
    // ② 判决逐条一致（三侧）
    const cases = [...UNR_KILL.map((x) => x[0]), ...UNR_KEEP];
    const f3 = [core, dshF, zcF].map((m) => m.passesUnresolvedFilters);
    const diff = cases.filter((c) => f3[0](c) !== f3[1](c) || f3[0](c) !== f3[2](c));
    diff.length === 0
      ? ok(`三侧判决一致（${cases.length} 条样本：${UNR_KILL.length} 条该拦 + ${UNR_KEEP.length} 条该放）`)
      : bad('三侧判决不同：' + diff.map((c) => JSON.stringify(c.slice(0, 18))).join(' ／ '));
    // ③ 名额同值：核心 / 插件 / ZCode 三处都必须是内核那个数
    const slots = [core.UNR_SLOTS, dshF.UNR_SLOTS, zcF.UNR_SLOTS];
    slots.every((x) => x === core.UNR_SLOTS)
      ? ok(`UNR_SLOTS 三侧同源 = ${core.UNR_SLOTS}（核心=${slots[0]} 插件=${slots[1]} ZCode=${slots[2]}）`)
      : bad(`UNR_SLOTS 三侧不一致：核心=${slots[0]} 插件=${slots[1]} ZCode=${slots[2]}`);
    // ④ 反向保证：index.js / brief-shared.mjs 里**不许再各自写死**一份名额（12d 之前各有一份）
    for (const [file, label] of [[DSH, 'DSH index.js'], ['C:/Users/crx/.zcode/hooks/statebrief/brief-shared.mjs', 'ZCode brief-shared.mjs']]) {
      const src = readFileSync(file, 'utf8');
      /^[^/\n]*\bconst UNR_SLOTS = \d+/m.test(src)
        ? bad(`${label} 里又出现了一份写死的 UNR_SLOTS —— 那是第三份副本，改成 import 权威值`)
        : ok(`${label} 无写死的 UNR_SLOTS（已转发内核）`);
    }
  }
} catch (e) { bad('三运行时同源检查失败: ' + (e?.message ?? e)); }
// ══════ ⑦b 七条规范过滤器的**行为对拍**（第三轮复审指出缺的那条）══════
// 复审的原话：「『调用层真的在』在行为意义上不可静态判定，只有同输入真跑能证」。
//   核对后发现这个洞是真的：§⑦ 只对 `passesUnresolvedFilters` 做三侧判决对拍，
//   **`passesBriefFilters` 一次都没被真正执行过**（守门里它只作为文本探针出现）。
// ⇒ 本节拿**真实库里抽出的决策文本**喂两侧，比判决。
//
// 为什么必须用真实数据：手写样本只能证明「手写的那几条一致」，
// 而真实文本里有转写碎片、编号列表、粘贴的代码块 —— 正是容易两边判得不一致的地方。
console.log('\n══════ ⑦b 七条规范过滤器 · 行为对拍（真实数据）══════');
try {
  const { DatabaseSync } = await import('node:sqlite');
  const os = await import('node:os');
  const fsx = await import('node:fs');
  const dF = await import(pathToFileURL(path.join(path.dirname(DSH), 'src/brief-filters.mjs')).href);
  const zF = await import(pathToFileURL('C:/Users/crx/.zcode/hooks/statebrief/brief-filters.mjs').href);
  const regPath = path.join(os.homedir(), '.sessionrelay-registry', 'projects.json');
  let texts = []
  let libCount = 0
  if (fsx.existsSync(regPath)) {
    for (const pr of JSON.parse(fsx.readFileSync(regPath, 'utf8')).projects || []) {
      const f = path.join(pr.root, '.sessionrelay', 'relay.sqlite')
      if (!fsx.existsSync(f)) continue
      libCount++
      let db = null
      try { db = new DatabaseSync(f, { readOnly: true }) } catch { continue }
      try {
        for (const row of db.prepare('SELECT decisions FROM sessions WHERE decisions IS NOT NULL').all()) {
          let decs = []
          try { decs = JSON.parse(row.decisions || '[]') } catch { continue }
          for (const x of decs) if (typeof x?.text === 'string' && x.text.trim()) texts.push(x.text)
        }
        // 未决池单独收：只靠 decisions 里的问号样本不够（实测带问号的只有 0 条 ⇒ 那是空转绿）
        for (const row of db.prepare('SELECT key_questions FROM sessions WHERE key_questions IS NOT NULL').all()) {
          let kq = []
          try { kq = JSON.parse(row.key_questions || '[]') } catch { continue }
          for (const x of kq) {
            const t = typeof x?.q === 'string' ? x.q : (typeof x === 'string' ? x : '')
            if (t.trim()) texts.push(t)
          }
        }
      } catch {}
      try { db.close() } catch {}
    }
  }
  const uniq = [...new Set(texts)]
  if (uniq.length === 0) {
    say('  ⚠️ 真实库里没抽到决策文本，本节跳过（不是「一致」，是「没样本」）')
  } else {
    const diffB = uniq.filter((t) => dF.passesBriefFilters(t) !== zF.passesBriefFilters(t))
    diffB.length === 0
      ? ok(`两侧判决逐条一致（真实决策文本 ${uniq.length} 条 / ${libCount} 个库；DSH 侧拦下 ${uniq.filter((t) => !dF.passesBriefFilters(t)).length} 条）`)
      : bad('两侧判决不同（' + diffB.length + '/' + uniq.length + '）：' + diffB.slice(0, 3).map((t) => JSON.stringify(String(t).slice(0, 26))).join(' ／ '))
    // 未决判据同样补一条真实数据对拍（§⑦ 只用手写样本）
    const uniqQ0 = [...new Set(uniq.filter((t) => /[?？]/.test(t)))]
    const uniqQ = uniqQ0
    const diffQ = uniqQ.filter((t) => dF.passesUnresolvedFilters(t) !== zF.passesUnresolvedFilters(t))
    diffQ.length === 0
      ? ok(`未决判据两侧判决逐条一致（带问号的真实文本 ${uniqQ.length} 条）`)
      : bad('未决判据两侧判决不同：' + diffQ.slice(0, 3).map((t) => JSON.stringify(String(t).slice(0, 26))).join(' ／ '))
    // ── 三方对拍：内核参照 vs 两份客户端 ──
    // 第四轮复审指出 §⑦b 的**结构性盲区**：「两侧同时被改坏（同一次同步把两份覆盖成同一份错误内容）」
    // 判决对拍抓不到（它们相等），§④ 的 md5 也抓不到（md5 同样相等）。
    // ⇒ 补**第三个参照**：核心库已导出 BRIEF_CANONICAL_FILTERS（只参照、不参与核心渲染，
    //   说明见 core/SessionRelay/src/cli/brief-filter.ts 与 docs/1018-七条规范过滤器-无第三方-结构原因.md）。
    //   三方里任何一份单独被改坏，另外两份都会指出来。
    const coreRef = await import(pathToFileURL(path.join(WS, 'core', 'SessionRelay', 'dist', 'recall.js')).href)
    if (typeof coreRef.passesBriefFilters !== 'function' || !Array.isArray(coreRef.BRIEF_CANONICAL_FILTERS)) {
      bad('核心 recall.js 没导出 BRIEF_CANONICAL_FILTERS（先在 core/SessionRelay 跑 npm run build）—— 三方对拍缺第三方')
    } else {
      const cc = coreRef.BRIEF_CANONICAL_FILTERS.map(String)
      const cd = dF.BRIEF_CANONICAL_FILTERS.map(String)
      const cz = zF.BRIEF_CANONICAL_FILTERS.map(String)
      if (JSON.stringify(cc) === JSON.stringify(cd) && JSON.stringify(cc) === JSON.stringify(cz)) {
        ok('七条规范过滤器**三方逐条同序同字**（内核/DSH/ZCode 各 ' + cc.length + ' 条）—— 两侧同改也抓得到了')
      } else {
        const off = [['内核', cc], ['DSH', cd], ['ZCode', cz]]
          .filter(([, x]) => JSON.stringify(x) !== JSON.stringify(cc))
          .map(([n, x]) => n + '（' + x.length + '条，首处不同在第 ' + (x.findIndex((r, i) => r !== cc[i]) + 1) + ' 条）')
        bad('七条规范过滤器三方不一致：' + off.join(' ／ '))
      }
      const diff3 = uniq.filter((t) => {
        const a1 = coreRef.passesBriefFilters(t)
        return a1 !== dF.passesBriefFilters(t) || a1 !== zF.passesBriefFilters(t)
      })
      diff3.length === 0
        ? ok('三方判决逐条一致（真实文本 ' + uniq.length + ' 条）')
        : bad('三方判决不同（' + diff3.length + '/' + uniq.length + '）：' + diff3.slice(0, 3).map((t) => JSON.stringify(String(t).slice(0, 26))).join(' ／ '))
    }  }
} catch (e) { bad('行为对拍失败: ' + String(e?.message ?? e).slice(0, 80)) }

// ══════ ⑦c 两条客户端**过滤链行为**一致（10:0x 补，唯一能抓「挪走一层」的断言）══════
// 病历（实测，不是推理）：把 DSH 侧 `CHATTER_TITLE` 那一层 `.filter` 整行删掉后 ——
//   §⑧ 的 **12 条探针全部仍然绿**（含 2 条数量型）：判据名在文件别处仍在场，
//   文本探针分辨不出「用没用」。而 1015 那次真实漂移恰恰就是这一类。
// ⇒ 必须比**输出**而不是文本。做法：两侧各自暴露过滤链（DSH `__testRenderItems`、
//   ZCode `__testFilterChain`），喂同一批真实样本，比留下的条目集合。
//
// 样本要**能触发各层**才有效：只喂真实数据时 title 大多非闲聊/非任务书，
//   那几层根本不会命中 —— 实测那样连删掉一层都测不出来（两边都留 200 条，输出相同）。
console.log('\n══════ ⑦c 两条客户端过滤链 · 行为对拍 ══════');
try {
  const osx = await import('node:os');
  const fsx = await import('node:fs');
  const plugIdx = await import(pathToFileURL(DSH).href)
  const zcIdx = await import(pathToFileURL('C:/Users/crx/.zcode/hooks/statebrief/brief-shared.mjs').href)
  if (typeof plugIdx.__testRenderItems !== 'function' || typeof zcIdx.__testFilterChain !== 'function') {
    bad('两侧没有暴露过滤链钩子（DSH __testRenderItems / ZCode __testFilterChain）—— 行为对拍无法进行')
  } else {
    const now = new Date().toISOString()   // ⚠️ 必须是 ISO 串：Date.parse(数字)=NaN ⇒ 新鲜度层会恒过
    const chainSamples = []
    let chainDec = [], chainUnr = []
    const regP2 = path.join(osx.homedir(), '.sessionrelay-registry', 'projects.json')
    if (fsx.existsSync(regP2)) {
      const { DatabaseSync } = await import('node:sqlite')
      for (const pr of JSON.parse(fsx.readFileSync(regP2, 'utf8')).projects || []) {
        const f = path.join(pr.root, '.sessionrelay', 'relay.sqlite')
        if (!fsx.existsSync(f)) continue
        let db2 = null
        try { db2 = new DatabaseSync(f, { readOnly: true }) } catch { continue }
        try {
          for (const row of db2.prepare('SELECT title, decisions, key_questions FROM sessions').all()) {
            const ti = String(row.title || '')
            try { for (const x of JSON.parse(row.decisions || '[]')) if (x?.text) chainDec.push({ text: x.text, at: now, pinned: x.pinned === true, title: ti }) } catch {}
            try { for (const x of JSON.parse(row.key_questions || '[]')) if (x?.q) chainUnr.push({ q: x.q, at: now, unresolved: true, pinned: false, title: ti }) } catch {}
          }
        } catch {}
        try { db2.close() } catch {}
      }
    }
    // 补会命中闲聊层/任务书层的样本（只喂真实数据时那两层常常根本不触发）
    for (const t of ['你好', 'hi', '测试', '你是红队审查员。任务：审查', 'act as reviewer', '任务：查召回']) {
      chainDec.push({ text: '闲聊会话里的一条决策文本，用来验证闲聊层是否生效', at: now, pinned: false, title: t })
      chainDec.push({ text: '子代理会话里的一条决策文本，用来验证任务书层是否生效', at: now, pinned: false, title: t })
      chainUnr.push({ q: '闲聊会话里的一个未决问题？', at: now, unresolved: true, pinned: false, title: t })
    }
    // 复审 S2：置顶豁免的 `key` 限定两侧**不一致** ——
      //   DSH:  `if (key === 'decisions' && d.pinned === true) return true`（未决链的 pinned 仍过新鲜度窗）
      //   ZCode: `if (d.pinned === true) return true`（直接短路豁免，不看 key）
      // 真实库 key_questions 的 pinned 全是 false ⇒ 不补样本这条分叉**永远测不到**。
    //   而要看出分叉，未决样本必须**带 at 且已过期**（fresh 的样本两侧都过，看不出差别）。
    const expired = new Date(Date.now() - 30 * 86400000).toISOString()
    chainDec.push({ text: '置顶且过期的决策，用来验证置顶豁免新鲜度窗', at: expired, pinned: true, title: '' })
    chainDec.push({ text: '未置顶且过期的决策，用来验证非置顶会被新鲜度窗砍掉', at: expired, pinned: false, title: '' })
    chainUnr.push({ q: '置顶且过期的未决问题？', at: expired, unresolved: true, pinned: true, title: '' })
    chainUnr.push({ q: '未置顶且过期的未决问题？', at: expired, unresolved: true, pinned: false, title: '' })
    // 无 at 的样本：验证两侧对「时间不可解析」的处理一致
    chainDec.push({ text: '没有时间字段的决策文本，用来验证时间不可解析时的处理', pinned: false, title: '' })
    chainDec.push({ text: '否定性决策样例，用来验证 ✗ 前缀两侧一致', at: now, pinned: false, kind: 'negative', title: '' })
    const A1 = plugIdx.__testRenderItems(chainDec, 'decisions', 100000)
    const B1 = zcIdx.__testFilterChain(JSON.stringify({ decisions: chainDec }), 'decisions', 100000, 48 * 3600_000)
    const A2 = plugIdx.__testRenderItems(chainUnr, 'unresolved', 100000)
    const B2 = zcIdx.__testFilterChain(JSON.stringify({ unresolved: chainUnr }), 'unresolved', 100000, 48 * 3600_000)
    // 排序层也要测：上面两路都传 max=100000，**长名单下排序不影响输出集合** ⇒ 排序从未被测。
    // 而「置顶优先 + 时间倒序」是简报真实语义的一部分（用户 pin 的东西要真的排在最前）。
    // 这里用生产同款的小名额（决策 4 / 未决 1），排序立刻会体现在输出**顺序**上。
    const A3 = plugIdx.__testRenderItems(chainDec, 'decisions', 4)
    const B3 = zcIdx.__testFilterChain(JSON.stringify({ decisions: chainDec }), 'decisions', 4, 48 * 3600_000)
    const A4 = plugIdx.__testRenderItems(chainUnr, 'unresolved', 1)
    const B4 = zcIdx.__testFilterChain(JSON.stringify({ unresolved: chainUnr }), 'unresolved', 1, 48 * 3600_000)
    const txtX = (x) => JSON.stringify(x || [])
    // ⚠️ 这一行必须以 `const` 开头，不能直接写条件表达式。
    // 病历（实测，我为此排查了很久）：原来这里是无分号的 `const txtX = ...`
    //   后面紧跟一行 `(条件)`。JS 的 ASI 不会在那里插分号 —— 那个 `(条件)`
    //   被**吸进箭头函数体**当成调用，于是整个三元表达式成了死代码。
    //   `node --check` 照样通过（语法合法），运行时却一行都不打印。
    //   ⇒ 凡是无分号表达式后面紧跟以 `(` 开头的行，都是这个坑。
    const sortSame = txtX(A3) === txtX(B3) && txtX(A4) === txtX(B4)
    sortSame
      ? ok('排序层一致（小名额下取前 N：决策前 4 / 未决前 1，两侧取到同一批且同序）')
      : bad('排序层不一致（决策前 4: ' + txtX(A3) + ' vs ' + txtX(B3) + '；未决前 1: ' + txtX(A4) + ' vs ' + txtX(B4) + '）')
    const txt = (x) => JSON.stringify(x || [])   // 两侧返回的**就是渲染串**，直接比；不要去取 .text
    // ⚠️ 新鲜度窗两侧**本来就不对称**（不是本节引入的）：DSH 的 FRESH_MS 硬编码 48h，
    //   ZCode 侧由调用方传 maxAgeMs。这里传 7 天 —— 今天安全（样本 at 全是 now），但最脆：
    //     · 实参改小或样本 at 变旧 ⇒ 立刻假红；
    //     · DSH 的 FRESH_MS 调短 ⇒ 两边都留 0 条 ⇒ txt([])===txt([]) 判绿 —— 空集合必然相等。
    //   ⇒ 留 0 条一律判红：空集合不是「一致」，是「样本全被淘汰了」。
    for (const [label, a, b] of [['决策链', A1, B1], ['未决链', A2, B2]]) {
      const na = (a || []).length, nb = (b || []).length
      if (na === 0 || nb === 0) {
        bad(label + '有一侧或两侧留 0 条（DSH ' + na + ' / ZCode ' + nb + '）—— **这不是「一致」**；多半是新鲜度窗把样本全淘汰了（DSH 硬编码 48h，这里给 ZCode 传 7 天）')
        continue
      }
      const same = txt(a) === txt(b)
      same
        ? ok(`${label}两侧输出逐条相同（样本 ${label === '决策链' ? chainDec.length : chainUnr.length} 条 → 各留 ${(a || []).length} 条）`)
        : bad(`${label}两侧输出不同（DSH 留 ${(a || []).length} / ZCode 留 ${(b || []).length}）—— 过滤链有一层只在一侧生效`)
    }
  }
} catch (e) { bad('过滤链行为对拍失败: ' + String(e?.message ?? e).slice(0, 80)) }

// ══════ ⑧ 两条客户端的**过滤链**齐平（U-A 调研件 §6.4 补做）══════
// 病历：U-A 调研诚实登记过「未逐行比对 index.js 与 brief-shared.mjs 的过滤器链」，也就是说
//   **两侧链条是否漂移一直靠人记性**。而 1015 那次漂移恰好就是这一类（DSH 多一条而 ZCode 没有，
//   而用户日常在 ZCode 侧干活）。本节把它变成断言。
//
// 口径说明（踩过一次坑，写在这儿免得下一个人重踩）：**判据用「整份文件里有没有这段判据」**，
//   不用「先切出过滤链子串再找」。我第一版按 `.filter((d) => {` 切片，DSH 侧因为写的是
//   `.filter(d => ...)`（少一对括号）就被整段漏掉，得出「三条判据 ZCode 有而 DSH 没有」的**假警报**。
//   教训：切片提取比全文包含**更脆**，断言要选不会因格式差异而失效的那种。
console.log('\n══════ ⑧ 两条客户端过滤链齐平 ══════');
try {
  const dshSrc = readFileSync(DSH, 'utf8');
  const zcSrc = readFileSync('C:/Users/crx/.zcode/hooks/statebrief/brief-shared.mjs', 'utf8');
  const CHAIN_PROBES = [
    ['施工会话碎片', 'workflow subagent'],
    ['粘包伪影', '[-–]'],
    ['闲聊标题', 'CHATTER_TITLE'],
    ['子代理任务书', 'SUBAGENT_TASK_TITLE'],
    ['决策疑问句', '怎么办|能不能'],
    ['报告/审稿碎片', '被当成'],
    ['报告开头', '^(报告|原文'],
    ['七条规范过滤器', 'passesBriefFilters'],
    ['未决四条 + 残片守卫', 'passesUnresolvedFilters'],
    ['置顶豁免', 'pinned'],
    // ⚠️ [独立复审后加 09:0x] 上面那个裸词 'pinned' 守不住：两侧各有 3~4 处 'pinned === true'，
    //   删掉其中任何一层豁免，探针仍为真 ⇒ §⑧ 会**假绿**，而这层是产品规则（用户 pin 过的东西要尊重）。
    //   复审给的实测：DSH 4 处、ZCode 6 处。
    //   ⇒ 改成数**「豁免层」的确切形态**出现几次，两侧次数必须相等 —— 删一层就会少一次。
    ['置顶豁免层·新鲜度', 'd.pinned === true) return true'],
    ['置顶豁免层·未决段', "(key === 'decisions' || d.pinned === true)"],
  ];
  // ⚠️ [独立复审第二轮后加 09:0x] **import ≠ 调用**。
  //   复审指出：裸探针 `passesBriefFilters` 在 index.js:52(import) 与 :171(调用) 各命中一次，
  //   删掉 :171 的**调用层**后 import 还在 ⇒ 探针仍为真 ⇒ §⑧ 假绿，**而 DSH 侧已不过滤**。
  //   实测确认这个洞当前是**潜在**的（调用层还在）。
  //   ⇒ 对「过滤器被调用」这类判据，改问**带调用形态的整行**（`.filter(...)` 包住函数名），
  //   import 行永远不含 `.filter(`，所以满足不了这条。
  const CALL_PROBES = [
    ['七条规范过滤器·被调用', '.filter((d) => passesBriefFilters('],
    ['未决四条·被调用', '.filter((d) => (key === \'decisions\' || d.pinned === true) ? true : passesUnresolvedFilters('],
  ];
  const callMiss = CALL_PROBES.filter(([, p]) => dshSrc.includes(p) !== zcSrc.includes(p));
  callMiss.length === 0
    ? ok(`过滤器**调用层**两侧都在场（${CALL_PROBES.length} 条 —— import 行满足不了这几条，删掉调用会被抓到）`)
    : bad('过滤器调用层已漂：' + callMiss.map(([n, p]) => n + '（DSH=' + dshSrc.includes(p) + ' ZCode=' + zcSrc.includes(p) + '）').join(' ／ '));

  // 数量型判据：裸子串只能问「在不在」，问不了「够不够」。这几条问的是**层数**，
  // 所以单独走「出现次数必须相等」的判据 —— 删掉一层豁免，次数就少一次，会被抓到。
  const COUNT_PROBES = [
    ['置顶豁免层·新鲜度', 'd.pinned === true) return true'],
    ['置顶豁免层·未决段', "(key === 'decisions' || d.pinned === true)"],
  ]
  // 看板通道（09:5x 补）：`kanbanText` / `kanbanLines` 的**筛选判据**两侧必须逐字相同。
  // ⚠️ 它们的**配额与输出形态是刻意不同的**（DSH 2 行×72 字符 bullet vs ZCode 3 行×280 字符表格，
  //   ZCode 还多一个更新时间），那是产品决策 —— **这里刻意不设断言**。
  //   理由与数字见 `docs/1018-看板通道两侧差异.md`。
  //   守门该管「同一处知识多份副本」，不该管「产品决定不同」。
  // ⚠️ 判据取**整条表达式**而不是前缀 —— 第一版只取前缀 `...test(c[2] ?? '')`，
  //   实测在 ZCode 侧把 `/[🔄⛔]/u` 改成 `/[🔄⛔⏳]/u` 时**仍然绿**（前缀两边都在场），
  //   也就是我自己写的那条断言当场放过了真实漂移。前缀是「同改盲区」的又一例。
  const KANBAN_PROBE = ".filter((c) => c.length >= 5 && /^[✅🔄⛔⬜]/u.test(c[2] ?? '') && /[🔄⛔]/u.test(c[2] ?? ''))"
  const kanbanSame = dshSrc.includes(KANBAN_PROBE) && zcSrc.includes(KANBAN_PROBE)
  kanbanSame
    ? ok('看板筛选判据两侧逐字相同（配额与输出形态**刻意不同**，不设断言 —— 见 docs/1018-看板通道两侧差异.md）')
    : bad('看板筛选判据两侧不一致（DSH=' + dshSrc.includes(KANBAN_PROBE) + ' ZCode=' + zcSrc.includes(KANBAN_PROBE) + '）—— 这条**该**两侧一致，只有配额与形态才刻意不同')
  const miss = CHAIN_PROBES.filter(([, p]) => dshSrc.includes(p) !== zcSrc.includes(p));
  const cntMiss = COUNT_PROBES.filter(([, p]) => {
    const n = (s) => s.split(p).length - 1
    return n(dshSrc) !== n(zcSrc)
  });
  cntMiss.length === 0
    ? ok(`置顶豁免层数两侧一致（${COUNT_PROBES.map(([n, p]) => n + '×' + ((dshSrc.split(p).length - 1))).join(' / ')}）`)
    : bad('置顶豁免层数已漂：' + cntMiss.map(([n, p]) => n + '（DSH=' + (dshSrc.split(p).length - 1) + ' ZCode=' + (zcSrc.split(p).length - 1) + '）').join(' ／ '));
  miss.length === 0
    ? ok(`两条客户端过滤链齐平（${CHAIN_PROBES.length} 条判据两侧都在场）`)
    : bad('过滤链已漂：' + miss.map(([n, p]) => n + '（DSH=' + dshSrc.includes(p) + ' ZCode=' + zcSrc.includes(p) + '）').join(' ／ '));
  for (const name of ['CHATTER_TITLE', 'SUBAGENT_TASK_TITLE']) {
    const g = (s) => { const m = s.match(new RegExp('(?:export\\s+)?const\\s+' + name + '\\s*=\\s*(/[^\\n]*?/\\w*)')); return m ? m[1] : null };
    const a2 = g(dshSrc), b2 = g(zcSrc);
    (a2 && b2 && a2 === b2)
      ? ok(`${name} 两侧正则源串逐字相同`)
      : bad(`${name} 两侧不一致：DSH=${a2} ZCode=${b2}`);
  }
} catch (e) { bad('过滤链齐平检查失败: ' + (e?.message ?? e)); }

process.exit(fail === 0 ? 0 : 1);
