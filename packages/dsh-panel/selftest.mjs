#!/usr/bin/env node
// selftest.mjs —— 面板宿主半的**真链路**自测（不需要重启 DSH）
//
// 为什么能不要 DSH：宿主半只依赖两个面 —— ctx.webServer.register（注册路由）与 ctx.provide（命名服务）。
// 这里用最小的假 ctx 把真 handler 拿到手，起一个真的 http 服务器，然后**发真的 HTTP 请求**打真数据。
// 报"路由 404"那一类问题（上次的病）在这里就会现形，而不是等用户重启完才发现。
//
// 用法：
//   node integrations/dsh-srelay-panel/selftest.mjs          # 全部（含一次真 CLI 动作）
//   node integrations/dsh-srelay-panel/selftest.mjs --quick  # 跳过 CLI 动作（快）
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUICK = process.argv.includes('--quick');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  🔴 ' + name + (detail ? ' —— ' + detail : '')); } };

// ── 假 ctx：只做 DSH 对宿主半做的那两件事 ──
const registered = [];
const provided = {};
const ctx = {
  webServer: { register(route) { registered.push(route); return () => { const i = registered.indexOf(route); if (i >= 0) registered.splice(i, 1); }; } },
  provide(name, value) { provided[name] = value; },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {}; },
};

const host = await import(new URL('./lib/index.js', import.meta.url).href);
host.apply(ctx);

console.log('记忆台面板 · 宿主半自测');
console.log('① 注册面');
ok('注册了路由（prefix）', registered.length === 2, '实际 ' + registered.length + ' 条');
ok('路由前缀是 /srelay/api', registered.some((r) => r.path === '/srelay/api' && r.kind === 'prefix'));
ok('保留了旧前缀 /srelay-panel/api（曾 404 的那个）', registered.some((r) => r.path === '/srelay-panel/api'));
ok('发布了命名服务 sessionrelay', !!provided.sessionrelay && typeof provided.sessionrelay.overview === 'function');

// ── 起真服务器，选第一条路由的 handler（别名指向同一个 handler）──
const handler = registered[0].handler;
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const base = 'http://127.0.0.1:' + PORT;

async function call(method, params, opts) {
  const post = opts && opts.post;
  const url = post ? base + '/srelay/api/' + method : base + '/srelay/api/' + method + '?' + new URLSearchParams(params || {});
  const res = await fetch(url, post ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params || {}) } : {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* 见下 */ }
  return { status: res.status, json, text };
}

console.log('② 自诊断（真 HTTP）');
const diag = await call('diagnostics');
ok('HTTP 200', diag.status === 200, 'status ' + diag.status);
ok('内核面板进口已载入', diag.json && diag.json.data && diag.json.data.coreLoaded === true, diag.json && diag.json.data && diag.json.data.coreError);
ok('只读驱动是 node:sqlite（插件零 npm 依赖的前提）', diag.json && diag.json.data && diag.json.data.driver === 'node:sqlite', JSON.stringify(diag.json && diag.json.data && diag.json.data.driver));
ok('旧前缀 /srelay-panel/api 也通', (await fetch(base + '/srelay-panel/api/diagnostics')).status === 200);

console.log('③ 总览（真数据）');
const ov = await call('overview');
const od = ov.json && ov.json.data;
ok('返回 ok', !!(ov.json && ov.json.ok), JSON.stringify(ov.json && ov.json.error));
ok('读到项目库（≥1）', od && od.projects.length >= 1, 'projects=' + (od && od.projects.length));
ok('会话数 > 0', od && od.totals.sessions > 0, 'sessions=' + (od && od.totals.sessions));
ok('经验层可读且有条目', od && od.lessons && od.lessons.total >= 1, 'lessons=' + JSON.stringify(od && od.lessons && od.lessons.total));
ok('经验层的"能进注入层"计数与实际判据一致', od && od.lessons && od.lessons.items.every((i) => i.injectable === (i.status === 'verified' && i.grade !== 'inferred' && i.live >= od.lessons.threshold)), '阈值 ' + (od && od.lessons && od.lessons.threshold));
ok('生命周期可读', od && od.lifecycle && od.lifecycle.stages.length > 0, 'stages=' + (od && od.lifecycle && od.lifecycle.stages.length));
ok('有心跳（守护在线判据同源）', od && od.watchdog && typeof od.watchdog.online === 'boolean');
ok('口径脚注齐全（铁律 22）', od && od.criteria && Object.keys(od.criteria).length >= 8);

console.log('④ 压缩图谱');
const anyProject = ((od && od.projects || []).find((p) => p.ok) || {}).root;
const cp = await call('compression', { root: anyProject });
const cd = cp.json && cp.json.data;
ok('返回 ok', !!(cp.json && cp.json.ok), JSON.stringify(cp.json && cp.json.error));
ok('L0/L2/老化计划三段都有', !!(cd && cd.l0 && cd.l2 && cd.aging));
ok('L1 如实标成"已否决"（不许显示成在跑）', cd && cd.layers.some((l) => l.id === 'L1' && l.status === 'rejected'));
ok('老化热窗与 ADR-003 一致（30 天 / 强度门 0.667）', cd && cd.aging.hotDays === 30 && cd.aging.hotGate === 0.667, JSON.stringify(cd && cd.aging));
ok('缺参数时给的是错误对象（不是空数据）', (await call('compression', {})).json.ok === false);

console.log('⑤ 设置旋钮');
const cfgv = await call('config', { root: anyProject });
const knobs = cfgv.json && cfgv.json.data && cfgv.json.data.knobs;
ok('返回 ok', !!(cfgv.json && cfgv.json.ok), JSON.stringify(cfgv.json && cfgv.json.error));
// 判据不写死数字：直接与内核的旋钮清单比（多一个少一个都要红）
const corePanel = await import(new URL('./vendor/dist/panel.js', import.meta.url).href);
ok('旋钮数量与内核清单逐条一致（' + corePanel.KNOB_SPECS.length + ' 个）',
  knobs && knobs.length === corePanel.KNOB_SPECS.length && knobs.every((k, i) => k.path === corePanel.KNOB_SPECS[i].path),
  'knobs=' + (knobs && knobs.length));
const corePrefixes = [...new Set(corePanel.KNOB_SPECS.map((k) => k.path.split('.')[0]))];
// [1021] 判据不写死组数 —— 原来写死 `length === 8`，加一组（decay）就红。
//   改成「必须包含这几组」，加新组不再要改测试，**删组才会红**。
const REQUIRED_CORE_PREFIXES = ['capture', 'search', 'privacy', 'identity', 'semantic', 'compress', 'archive', 'recompute', 'decay'];
const missingCorePrefixes = REQUIRED_CORE_PREFIXES.filter((p) => !corePrefixes.includes(p));
ok('核心清单覆盖全部必需前缀（' + REQUIRED_CORE_PREFIXES.length + ' 组必填，实有 ' + corePrefixes.length + ' 组）',
  missingCorePrefixes.length === 0, missingCorePrefixes.length ? ('缺: ' + missingCorePrefixes.join(', ')) : corePrefixes.join(', '));
ok('每个旋钮都标了取值层', knobs && knobs.every((k) => ['env', 'config', 'default'].includes(k.source)));
ok('每个旋钮都带人话解释', knobs && knobs.every((k) => typeof k.hint === 'string' && k.hint.length > 4));

console.log('⑥ 写入路径（临时项目，不碰真库）');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srelay-panel-self-'));
fs.mkdirSync(path.join(tmp, '.sessionrelay'), { recursive: true });
const bad = await call('applyConfig', { root: tmp, patch: { 'capture.mode': '乱写' } }, { post: true });
ok('非法值整批拒绝', !!(bad.json && bad.json.ok === false && bad.json.data && bad.json.data.rejected.length === 1), JSON.stringify(bad.json && bad.json.data && bad.json.data.rejected));
ok('被拒时**没有**写文件', !fs.existsSync(path.join(tmp, '.sessionrelay', 'config.json')));
const repPatch = {
  'capture.mode': 'meta',
  'search.tokenizer': 'bigram',
  'privacy.export_redact': true,
  'identity.author': 'swiss-designer',
  'semantic.enabled': true,
  'compress.enabled': true,
  'archive.hot_days': 45,
  'recompute.check_every_min': 180,
};
const good = await call('applyConfig', { root: tmp, patch: repPatch }, { post: true });
const gd = good.json && good.json.data;
ok('8 组代表旋钮写入成功', !!(good.json && good.json.ok === true && gd && gd.changed.length === 8), JSON.stringify(good.json));
ok('换分词器给了"必须重算"提醒', !!(gd && gd.warnings.join('').includes('重算')));
const back = await call('config', { root: tmp });
const backKnobs = back.json && back.json.data && back.json.data.knobs;
const repReadOk = Object.entries(repPatch).every(([k, v]) => {
  const item = backKnobs && backKnobs.find((x) => x.path === k);
  return item && item.value === v && item.source === 'config';
});
ok('8 组代表旋钮（含 compress.enabled）读回新值且标记为 config 层', repReadOk);
fs.rmSync(tmp, { recursive: true, force: true });

console.log('⑦ 错误面');
ok('未知方法 → 404', (await call('没有这个方法')).status === 404);
ok('POST 坏 JSON → 400', (await fetch(base + '/srelay/api/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })).status === 400);
ok('PUT → 405', (await fetch(base + '/srelay/api/overview', { method: 'PUT' })).status === 405);

console.log('⑧ 动作白名单');
const act = await call('actions');
const ad = act.json && act.json.data;
// [1021] 判据不写死条数 —— 原来写死 `length === 5`，加一条「重建标签图谱」就红。
//   改成「必须包含这几条」：加动作不用改测试，**删动作才会红**。
const REQUIRED_ACTIONS = ['scan', 'sync', 'recompute', 'compact', 'clean', 'tags'];
const missingActions = REQUIRED_ACTIONS.filter((x) => !(ad && ad.actions.some((a) => a.id === x)));
ok('必需动作都在（' + REQUIRED_ACTIONS.length + ' 条必填，实有 ' + ((ad && ad.actions.length) || 0) + ' 条）',
  missingActions.length === 0, missingActions.length ? ('缺: ' + missingActions.join(', ')) : JSON.stringify(ad && ad.actions.map((a) => a.id)));
if (!ad.cli) console.log('  ⓘ 没找到内核 CLI（作者副本正常，部署副本里 dsh-srelay-brief 会兜住）：' + String(ad.cliHint).slice(0, 80));
ok('每个动作都标了会不会写', !!(ad && ad.actions.every((a) => typeof a.writes === 'boolean')));
const wr = await call('run', { op: '不存在' }, { post: true });
ok('非白名单动作被拒', wr.json.ok === false && String(wr.json.error.message).includes('白名单'));
const w2 = await call('run', { op: 'sync' }, { post: true });
ok('写操作未勾"真的写" → 拒绝（不许悄悄写）', w2.json.ok === false && String(w2.json.error.message).includes('没有演练模式'));

if (!QUICK) {
  console.log('⑨ 真跑一次动作（证明子进程链通）');
  if (ad.cli) {
    const t = Date.now();
    const real = await call('run', { op: 'scan' }, { post: true });
    const rd = real.json && real.json.data;
    ok('经插件跑真动作（doctor）拿到了输出（' + ((Date.now() - t) / 1000).toFixed(1) + 's）',
      !!(rd && typeof rd.out === 'string' && rd.out.length > 20), JSON.stringify(real.json && real.json.error));
  }
  const envCli = process.env.SRELAY_CLI_PATH;
  const cliPath = envCli || (() => {
    const p = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'local-plugins', 'dsh-srelay-brief', 'vendor', 'dist', 'srelay.js');
    return fs.existsSync(p) ? p : null;
  })();
  if (!cliPath) {
    console.log('  ⓘ 找不到真内核（设 SRELAY_CLI_PATH 或装 dsh-srelay-brief）——跳过');
  } else {
    const runEnv = { ...process.env, SRELAY_CLI_PATH: cliPath };
    const t0 = Date.now();
    // 子进程用的是宿主插件自己解析的路径，这里直接验"能拉起来、能拿到输出"
    const out = await new Promise((resolve) => {
      try {
        const r = execFileSync(process.execPath, [cliPath, 'lifecycle', '--status', '--json'], { encoding: 'utf8', timeout: 60000, env: runEnv, windowsHide: true });
        resolve({ ok: true, text: String(r) });
      } catch (e) { resolve({ ok: false, text: String((e && (e.stdout || e.message)) || e) }); }
    });
    ok('内核 CLI 能跑并返回 JSON（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）', out.ok && out.text.trim().startsWith('{'), out.text.slice(0, 200));
  }
}

// ── ⑩ 客户端半边：语法 + 注册面 + 清单约定 ──
// 为什么必须有这一节：客户端半是**浏览器**里跑的，Node 侧的任何自测都碰不到它。
// 实测踩到过：client.js 少一个右括号 ⇒ DSH 里"左栏没有那个按钮"，而所有自检全绿
// （宿主半好好的、路由也通）。语法一行就能查，别再让这类错误靠肉眼。
console.log('⑩ 客户端半边');
const clientSrc = fs.readFileSync(path.join(HERE, 'lib', 'client.js'), 'utf8');
let syntaxBad = null;
try { new vm.Script(clientSrc, { filename: 'client.js' }); } catch (e) { syntaxBad = String(e && e.message || e); }
ok('client.js 语法能过（浏览器侧没人替你查这个）', !syntaxBad, syntaxBad);
ok('注册了左栏入口 sidebar.panellist', clientSrc.includes("inject('sidebar.panellist'") || clientSrc.includes('inject(\'sidebar.panellist\''));
ok('注册了主面板 main keyed slot', /inject\('main'/.test(clientSrc) && /name: 'main'/.test(clientSrc));
// 按钮与面板必须用**同一个键**（侧栏按 id 寻址 main 的 key）：两处都得是 PANEL_ID，不许各写一个字符串
ok('用同一个 id 串起按钮与面板',
  /id: PANEL_ID/.test(clientSrc) && /key: PANEL_ID/.test(clientSrc) && /const PANEL_ID = 'srelay'/.test(clientSrc),
  JSON.stringify({ id: /id: PANEL_ID/.test(clientSrc), key: /key: PANEL_ID/.test(clientSrc) }));
ok('取数用相对地址（前缀安全）', clientSrc.includes("new URL('.', base)"));
ok('没有写死的 /srelay 绝对路径', !/fetch\('\/srelay/.test(clientSrc));
// 防复发断言：客户端必须覆盖核心清单全部 8 组前缀（尤其是 compress）
const groupDefMatch = clientSrc.match(/(?:const|let|var)\s+(?:KNOB_GROUPS|GROUP_META)\s*=\s*(\[[^;]+\]|\{[^;]+\})/);
let clientKnobPrefixes = [];
if (groupDefMatch) {
  try {
    const parsed = new Function('return ' + groupDefMatch[1])();
    clientKnobPrefixes = Array.isArray(parsed) ? parsed.map((item) => Array.isArray(item) ? item[0] : item) : Object.keys(parsed);
  } catch {}
}
const missingPrefixes = corePrefixes.filter((p) => !clientKnobPrefixes.includes(p));
ok('客户端旋钮分组定义完整覆盖核心全部 8 组前缀（防遗漏 compress）',
  missingPrefixes.length === 0, '缺失前缀: ' + missingPrefixes.join(', '));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
ok('清单声明 dsh.client.platform = web（DSH 加载客户端半的约定）', !!(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web'));
ok('导出 ./client 且文件存在', !!(pkg.exports && pkg.exports['./client']) && fs.existsSync(path.join(HERE, pkg.exports['./client'].replace(/^\.\//, ''))));

server.close();
console.log('\n' + (fail ? '🔴 ' + fail + ' 项失败 / ' + (pass + fail) + ' 项' : '✅ 全绿（' + pass + ' 项）'));
process.exit(fail ? 1 : 0);
