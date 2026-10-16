#!/usr/bin/env node
/**
 * ses-recall-probe — 「零上下文接手」检索召回实测（2026-10-15 深夜建）
 *
 * 回答的问题：**换个说法问，历史会话能不能被找到？**
 * 口径：20 条「大白话问句」+ 20 条对应的「关键词问句」，各自打真正的检索入口
 *       （node core/SessionRelay/dist/srelay.js search --json --limit 10），
 *       命中判定 = top-10 里是否出现**真含该事实的会话**（事实由锚点串在库内 LIKE 判定）。
 *
 * 为什么锚点判定而不是人工标注：锚点是可复算的客观量（跑一遍 SQL 就知道含不含），
 * 人工标注一改口径就没法复现。副作用：锚点串是「代码标识符/专名」时天然利于关键词臂——
 * 这正是我们要量化的那个差（关键词 vs 大白话）。
 *
 * 用法：
 *   node tools/ses-recall-probe.mjs                       # 默认 agent1super + SES 两个库
 *   node tools/ses-recall-probe.mjs --json artifacts/recall-1015.json
 */
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/dsh插件  记忆';
const DIST = ROOT + '/core/SessionRelay/dist/srelay.js';

/** 20 问：anchor=库内判定用的客观锚点；kw=关键词问法；nl=大白话问法（不含锚点词） */
export const CASES = [
  { anchor: '硬链接',           kw: '硬链接 .pnpm',             nl: '我改完插件源码了但跑起来还是旧的行为，是什么原因？' },
  { anchor: 'MAX_CHARS',        kw: 'MAX_CHARS 简报',           nl: '简报太长会不会被截断，上限是多少？' },
  { anchor: 'EXTRACT_VERSION',  kw: 'EXTRACT_VERSION 重算',     nl: '抽取规则改了以后，之前存下来的老会话要怎么办？' },
  { anchor: 'board.mmd',        kw: 'board.mmd 看板',           nl: '任务进度能不能自动画成一张图？' },
  { anchor: '六维',             kw: '六维 抽取器',              nl: '要不要把抽取的信息维度扩展一下？' },
  { anchor: '联邦',             kw: '联邦 跨项目',              nl: '有好几个项目，记忆能不能互相打通？' },
  { anchor: '误配',             kw: '误配 自动推翻',            nl: '能不能自动判断哪条旧决定已经过时了？' },
  { anchor: '断点',             kw: '断点 胶囊',                nl: '新会话能不能自动带着上一场的结论继续？' },
  { anchor: 'source.kind',      kw: 'source.kind 归属',         nl: '怎么知道我库里哪些消息是人打的、哪些是系统塞的？' },
  { anchor: '两阶段',           kw: '两阶段 检索',              nl: '检索要不要再加一层语义匹配？' },
  { anchor: '脏状态',           kw: '脏状态 git',               nl: '简报会不会提醒我有文件改了没提交？' },
  { anchor: '离线包',           kw: '离线包 zip',               nl: '怎么把这套东西拷到另一台没网的机器上？' },
  { anchor: 'brief-shared',     kw: 'brief-shared hook',        nl: 'ZCode 那边的简报是怎么取出来的？' },
  { anchor: '5ms',              kw: '5ms 预算',                 nl: '读一次记忆最多可以允许多慢？' },
  { anchor: 'topics',           kw: 'topics 系统回显',          nl: '为什么有些会话的标签里会混进奇怪的系统词？' },
  { anchor: '镜像',             kw: '镜像 副本',                nl: '同一个文件为什么要维护好几份拷贝？' },
  { anchor: '上游',             kw: '上游 合并',                nl: '还要不要跟着官方的版本更新走？' },
  { anchor: '归档',             kw: '归档 老会话',              nl: '太久没用到的那批老会话后来去哪了？' },
  { anchor: 'bigram',           kw: 'bigram jieba',             nl: '中文搜索是按什么切的词？' },
  { anchor: '去重',             kw: '去重 保留最新',            nl: '同一个结论重复出现好几次，最后留哪一条？' },
];

const TARGETS = [
  { label: 'A. agent1super（583 场 · SES 的活多数记在这里）', root: 'D:/agent1super', db: 'D:/agent1super/.sessionrelay/relay.sqlite' },
  { label: 'B. SES 自己的库（9 场 · 正确目录）',              root: ROOT,              db: ROOT + '/.sessionrelay/relay.sqlite' },
];

function arm(t) {
  const db = new DatabaseSync(t.db, { readOnly: true });
  const nSess = Number(db.prepare('SELECT COUNT(*) c FROM sessions').get().c);
  const nMsg = Number(db.prepare('SELECT COUNT(*) c FROM messages').get().c);
  const inSess = new Map();
  for (const c of CASES) {
    const rows = db.prepare('SELECT DISTINCT session_id id FROM messages WHERE content LIKE ?').all('%' + c.anchor + '%');
    inSess.set(c.anchor, new Set(rows.map((r) => String(r.id))));
  }
  const mega = new Set(db.prepare('SELECT id FROM sessions ORDER BY message_count DESC LIMIT 3').all().map((r) => String(r.id)));
  db.close();

  const run = (q) => {
    const r = spawnSync(process.execPath, [DIST, 'search', q, '--limit', '10', '--json'], { cwd: t.root, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
    if (r.status !== 0) return { hits: [], err: (r.stderr || '').slice(0, 160) };
    try { return JSON.parse(r.stdout); } catch { return { hits: [], err: 'badjson' }; }
  };

  const acc = { kw: [0, 0, 0], nl: [0, 0, 0] };
  let valid = 0, missing = 0, satTop1 = 0, satTop3 = 0;
  const uniqTop1 = new Set(), rows = [];
  for (const c of CASES) {
    const target = inSess.get(c.anchor);
    if (target.size === 0) { rows.push({ anchor: c.anchor, noAnswer: true }); missing++; continue; }
    valid++;
    const K = run(c.kw).hits || [], N = run(c.nl).hits || [];
    const ki = K.findIndex((h) => target.has(h.sessionId)), ni = N.findIndex((h) => target.has(h.sessionId));
    if (ki === 0) acc.kw[0]++; if (ki >= 0 && ki < 3) acc.kw[1]++; if (ki >= 0) acc.kw[2]++;
    if (ni === 0) acc.nl[0]++; if (ni >= 0 && ni < 3) acc.nl[1]++; if (ni >= 0) acc.nl[2]++;
    if (N[0] && mega.has(N[0].sessionId)) satTop1++;
    if (N.slice(0, 3).some((h) => mega.has(h.sessionId))) satTop3++;
    if (N[0]) uniqTop1.add(N[0].sessionId);
    rows.push({ anchor: c.anchor, kwRank: ki + 1 || 0, nlRank: ni + 1 || 0, nlTop3: N.slice(0, 3).map((h) => String(h.sessionId).slice(0, 8)), nlTop1Mega: !!(N[0] && mega.has(N[0].sessionId)) });
  }
  return { label: t.label, root: t.root, sessions: nSess, messages: nMsg, valid, missing, kw: acc.kw, nl: acc.nl, satTop1, satTop3, distinctTop1: uniqTop1.size, rows };
}

const arms = TARGETS.map(arm);
for (const a of arms) {
  console.log('##### ' + a.label + '   会话=' + a.sessions + '  消息=' + a.messages);
  console.log('  可测 = ' + a.valid + ' ；**库里根本没有答案的题** = ' + a.missing);
  console.log('  关键词  hit@1=' + a.kw[0] + '/' + a.valid + '  hit@3=' + a.kw[1] + '  hit@10=' + a.kw[2]);
  console.log('  大白话  hit@1=' + a.nl[0] + '/' + a.valid + '  hit@3=' + a.nl[1] + '  hit@10=' + a.nl[2]);
  console.log('  大白话 top1 落在巨型会话 = ' + a.satTop1 + '/' + a.valid + ' ；top3 含巨型 = ' + a.satTop3 + ' ；不同 top1 只有 ' + a.distinctTop1 + ' 个');
  for (const r of a.rows) console.log('   ' + r.anchor.padEnd(15) + (r.noAnswer ? '  ❌库里无答案' : '  KW@' + r.kwRank + '  NL@' + r.nlRank + '  ' + r.nlTop3.join(' ') + (r.nlTop1Mega ? ' [巨型]' : '')));
  console.log('');
}

const jf = process.argv.indexOf('--json');
if (jf > 0 && process.argv[jf + 1]) {
  const out = process.argv[jf + 1];
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), arms }, null, 2));
  console.log('已写出 ' + out);
}
