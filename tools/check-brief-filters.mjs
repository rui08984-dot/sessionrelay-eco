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

// ④ 单一权威源 brief-filters.mjs 两侧同字节（1015 起七条过滤器只有一份，物理消灭手抄）
{
  const crypto = await import('node:crypto');
  const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
  const AUTH = path.join(WS, 'plugins', 'dsh', 'src', 'brief-filters.mjs');
  const ZC = 'C:/Users/crx/.zcode/hooks/statebrief/brief-filters.mjs';
  try {
    const ha = md5(readFileSync(AUTH));
    const hz = md5(readFileSync(ZC));
    if (ha === hz) ok(`brief-filters.mjs 两侧同字节（md5 ${ha.slice(0, 12)}）`);
    else bad(`brief-filters.mjs 两侧不同步！
       权威源: ${ha}
       ZCode侧: ${hz}
       改过滤器只能改权威源再同步过去`);
  } catch (e) {
    bad(`读 brief-filters.mjs 失败: ${e.message}`);
  }
}

// ══════ ④ ADR-002 影子谓词（**只记录不生效**，但必须两侧在场且行为正确）══════
// 为什么守它：ADR 要求「新正则进 check-brief-filters 断言范围」。影子期它不参与过滤，
// 所以**没有其它任何东西会用到它**——一旦谁把它删了/改坏，不会有症状，直到将来接线时才炸。
// 断言双向：该命中的四类任务书标题要命中，正常标题一条都不许命中（否则接线时就是误杀）。
console.log('\n══════ ④ ADR-002 影子谓词（不生效）══════');
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

// ══════ ⑤ 未决段专用过滤器（U-A）══════
// 断言双向：四类噪声必须被拦 + 两条**差点被误杀的真问题**必须放行（第一版规则就是死在这两条上）。
console.log('\n══════ ⑤ 未决段过滤器（U-A）══════');
try {
  const dshF2 = await import(pathToFileURL(path.join(path.dirname(DSH), 'src/brief-filters.mjs')).href);
  const ZCDIR2 = 'C:/Users/crx/.zcode/hooks/statebrief';
  const zcF2 = await import(pathToFileURL(path.join(ZCDIR2, 'brief-filters.mjs')).href);
  const both = typeof dshF2.passesUnresolvedFilters === 'function' && typeof zcF2.passesUnresolvedFilters === 'function';
  both ? ok('两侧都导出 passesUnresolvedFilters') : bad('未决过滤器缺失（一侧或两侧）');
  if (both) {
    const KILL = [
      ['seq] --> L1[L1: 零拷贝语篇块剥离 Block-AST]', '图形残片'],
      ['呢他写了一份这个呃就是我给上游AI审计我们所有方案的一份md文件还是什么的', '口语转写'],
      ['并按现有路线推进 Phase 1/2/4？', '从句残片'],
      ['x'.repeat(90), '截断残片（90 字且无句末标点）'],
      ['```bash 这行到底怎么装？', '代码围栏'],
      ['subgraph 记忆层', 'Mermaid 头行'],
    ];
    for (const [q, why] of KILL) {
      dshF2.passesUnresolvedFilters(q) === false ? ok(`拦掉 ${why}`) : bad(`应拦未拦（${why}）：${q.slice(0, 24)}`);
    }
    // 红队反例必须在两侧都放行（v1 就是死在这条上）
    const KEEP = ['那一边的测试集怎么样了？', '呢思考预算还有一些细致的调节的是什么参数？', '后续还能增加什么？', '为什么模型只有那个3.8flash？', '所以现在到底该用哪个判据？'];
    const killed = KEEP.filter((q) => !dshF2.passesUnresolvedFilters(q));
    killed.length === 0 ? ok(`真问题 ${KEEP.length} 条一条未误杀`) : bad(`误杀真问题：${killed.join(' ／ ')}`);
  }
} catch (e) { bad('未决过滤器检查失败: ' + (e?.message ?? e)); }

console.log(fail === 0 ? '\n✅ 两侧简报过滤器一致' : `\n🔴 ${fail} 处不一致——这是"同一处知识多份副本"第 N 次被咬，改一侧必须改另一侧`);
process.exit(fail === 0 ? 0 : 1);
