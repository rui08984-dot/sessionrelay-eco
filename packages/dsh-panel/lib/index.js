// dsh-srelay-panel · 宿主端（原生面板的后端）
//
// ═══ 它解决的是什么 ═══
// 用户令："面板能不能像插件市场那样在 GUI 里有个按钮随时随地打开？而且面板不能再是 HTML，
// 要更完美的数据形态。"
// 前者：走 DSH 原生的 sidebar.panellist + main keyed slot（见 lib/client.js）。
// 后者：**没有第二套取数逻辑** —— 全部数字来自核心库的面板进口 vendor/dist/panel.js
//       （那里面是 core/panel/snapshot.ts 的唯一实现，CLI/测试/本插件共用）。
//
// ═══ 为什么这里没有 SQL、没有阈值、没有 node_modules ═══
//   · 取数：core/panel/*（面板模块本身零原生依赖，靠 node:sqlite 打开库）
//   · 判据：canInject 走 store/lesson-gate.ts，淘汰走 core/compact/aging.ts —— 都只有一份
//   · 所以本插件的 vendor 只需要 583KB 的 dist/，不需要 67MB 的 node_modules
//     （守门：tools/check-panel-deps.mjs 实测 dist/panel.js 的静态 import 只许是 node 内置）
//
// ═══ 纪律 ═══
//   · 只读打开项目库（openReadonly），绝不与守护争写锁；
//   · **容错不许静默**：核心库加载失败、某个项目库打不开，都要在响应的 errors[] 里留话，
//     而不是返回 0/空数组（"看起来在工作、其实没数据"是本项目第一号故障模式）；
//   · Cordis 的 apply() 必须同步 —— 所以内核用**顶层 await**（模块体，不是 apply 里）载入；
//   · 动作（scan/sync/recompute/clean）默认 dry-run，且**在子进程里跑**：
//     它们动辄全库重放，绝不许阻塞 DSH 宿主 UI。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const name = 'dsh-srelay-panel';
// webServer 是声明式依赖：没有它的 profile（headless）里本插件不会 apply —— 这是**正确**的行为
// （面板本来就没有 UI 可挂），且是响亮的失败而不是静默的半成品。
export const inject = ['webServer'];

export const ROUTE = '/srelay/api';
/** 旧客户端/书签用的别名：这个前缀曾经 404（宿主半边没装上），保留它免得人手抄的地址失效 */
export const ROUTE_ALIAS = '/srelay-panel/api';
export const PANEL_ID = 'srelay';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VENDOR_PANEL = path.join(HERE, 'vendor', 'dist', 'panel.js');

/** 内核面板进口。拿不到就**明说**：每条响应都带 coreError，不让它伪装成"没有数据" */
let core = null;
let coreError = null;
try {
  // 用 pathToFileURL(VENDOR_PANEL) 而不是 new URL('./vendor/...', import.meta.url)：
  // 后者相对的是 lib/index.js（会解析成 lib/vendor/...，实测第一次就栽在这）
  core = await import(pathToFileURL(VENDOR_PANEL).href);
} catch (e) {
  coreError = '内核面板进口载入失败（' + VENDOR_PANEL + '）：' + String(e && e.message || e);
}

// ─────────────────── 启动脚印（为什么落文件而不是 console）───────────────────
// DSH 是从图形界面起的：宿主进程的 stdout/stderr 没有人看。插件挂载失败时用户只看到
// "按钮没出现"，而唯一的两条线索（loader 的 stderr、apply 抛出的异常）全部丢在虚空里。
// 所以：模块被导入 / apply 被调用 / 每条路由注册成功 / 任何异常，都往这个文件追一行。
// 这是诊断设施，不是功能 —— 它自己失败绝不许连累插件，所以整个函数吞异常。
const BOOT_LOG = path.join(
  process.env.USERPROFILE || process.env.HOME || '.',
  '.sessionrelay', 'panel-boot.log',
);
function bootLog(line) {
  try {
    fs.mkdirSync(path.dirname(BOOT_LOG), { recursive: true });
    fs.appendFileSync(BOOT_LOG, new Date().toISOString() + ' pid=' + process.pid + ' ' + line + '\n');
  } catch { /* 记脚印失败不许影响插件本身 */ }
}
bootLog('import ok · core=' + (core ? 'loaded' : 'FAILED ' + coreError) + ' · cli=' + JSON.stringify(cliPath().file));

// ─────────────────── 动作白名单（默认 dry-run）───────────────────
// 这一层刻意不做任何"面板自己的实现"：每条只是**调用既有 CLI**，参数与 ses-serve 一致。
// 为什么不进程内跑：sync/recompute 会全库重放，放进 DSH 宿主进程就是卡 UI（ADR-002 的 weight 规则）。
// ⚠️ 诚实标注 writes：**这几个动作没有 dry-run 变体**（lifecycle 阶段一律真写，
//    doctor/sync/recompute 也没有 --dry）。原先的写法会给所有命令无脑追加 --apply，
//    而 lifecycle/recompute 根本不认这个参数 —— 点了就是报错（不是"演练"）。
//    所以：writes=true 的动作必须显式勾"真的写"才允许跑；想先看结果就用「压缩」页的
//    "全量干跑测量"（那条走的是 compactExactSessions(apply:false)，真只读）。
const ACTIONS = [
  { id: 'scan', title: '体检（只读）', desc: 'srelay doctor：报告哪里不一致，一个字节都不改', writes: false, argv: ['doctor'] },
  { id: 'sync', title: '立刻采一次', desc: '把各客户端刚产生的对话收进库（会写）', writes: true, argv: ['sync'] },
  { id: 'recompute', title: '按新规则重算旧对话', desc: '把还在用旧规则整理的会话重算到当前版本（会写）', writes: true, argv: ['recompute', '--batch', '200'] },
  { id: 'compact', title: '无损去重（L0 真跑）', desc: '同会话逐字重复合并，无损（会写）。想先看会动多少：去「压缩」页开"全量干跑测量"', writes: true, argv: ['lifecycle', '--once', '--only', 'compact'] },
  { id: 'clean', title: '清派生列脏数据', desc: '话题/文件列里的记账词与非文件条目（会写）', writes: true, argv: ['lifecycle', '--once', '--only', 'cleanup'] },
  // [1021 修我自己引入的不一致] 图谱页写着「急用可去『维护』里手动重建」，但那个按钮**根本不存在**。
  //   界面指向一个不存在的入口，比没有入口更糟 —— 用户会以为是自己找错了。补上。
  { id: 'tags', title: '重建标签图谱', desc: '按当前会话重新抽标签与共现边（会写，1~2 秒）', writes: true, argv: ['lifecycle', '--once', '--only', 'tags'] },
];

/** 找内核 CLI：① env 天窗 ② 兄弟插件 dsh-srelay-brief 自带的完整内核（含 node_modules） */
function cliPath() {
  const env = process.env.SRELAY_CLI_PATH;
  if (env && fs.existsSync(env)) return { file: env, how: 'env SRELAY_CLI_PATH' };
  // 相对 lib/index.js 找兄弟插件。**两种落盘布局都要覆盖**：pnpm 会把 file: 依赖复制进
  // node_modules/.pnpm/<entry>/node_modules/<pkg>（DSH 实际加载的就是这份），此时 '..' 的层数
  // 与 local-plugins 源码目录完全不同 —— 实测只写 local-plugins 那套时 cli=null（动作全废）。
  const CANDIDATES = [
    '../../dsh-srelay-brief/vendor/dist/srelay.js',          // local-plugins/<pkg>/lib
    '../../dsh-srelay-brief/dist/srelay.js',
    '../../../../../dsh-srelay-brief/vendor/dist/srelay.js', // node_modules/.pnpm/<entry>/node_modules/<pkg>/lib
    '../../../../../dsh-srelay-brief/dist/srelay.js',
  ];
  for (const rel of CANDIDATES) {
    try {
      const p = fileURLToPath(new URL(rel, import.meta.url));
      if (fs.existsSync(p)) return { file: p, how: '兄弟插件 dsh-srelay-brief 的内核' };
    } catch { /* 路径解码失败：继续找 */ }
  }
  return { file: null, how: null };
}

let running = null;   // 同时只允许一个动作（点两次不该起两个全库任务）

function runCli(args, { apply }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const { file, how } = cliPath();
    if (!file) {
      resolve({ ok: false, error: '找不到内核 CLI：既没有 SRELAY_CLI_PATH，也没有兄弟插件自带的 vendor（装 dsh-srelay-brief 或设 SRELAY_CLI_PATH）', durationMs: 0 });
      return;
    }
    // 只给**认这个参数**的命令追加 --apply（clean 走的是 ses-fix-topics 时代的约定；
    // 现在的 lifecycle 阶段不带该参数，所以这里只对显式声明 applies 的动作加）
    const argv = [...args, ...(apply && args.includes('--dry') ? ['--apply'] : [])];
    execFile(process.execPath, [file, ...argv], { timeout: 300000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        resolve({
          ok: !err, cli: file, how, argv,
          code: err && typeof err.code === 'number' ? err.code : 0,
          out: String(stdout || '').slice(-8000),
          err: String(stderr || '').slice(-2000),
          error: err ? String(err.message || err).slice(0, 300) : null,
          durationMs: Date.now() - t0,
        });
      });
  });
}

// ─────────────────── 服务面（route 与命名服务共用同一批函数）───────────────────
function requireCore() {
  if (!core) throw new Error(coreError || '内核面板进口不可用');
  return core;
}

const METHODS = {
  /** 总览：项目卡片 / 经验层 / 生命周期 / 心跳 / 错误清单 */
  overview(params) {
    return requireCore().panelOverview({ focus: params.focus ?? null });
  },
  /** 压缩图谱：L0 现成证据、L2 归档审计、老化计划；deep=1 才跑一次全量干跑 */
  compression(params) {
    // [1021 安全轴] root 来自 HTTP 查询参数，**必须过白名单**（只认注册表里登记过的项目根）。
    //   不校验的话，这个本地端点可以被用来探任意路径（见 core/panel/snapshot.ts 的 assertRegisteredRoot 注释）。
    const root = requireCore().assertRegisteredRoot(String(params.root || ''));
    if (!root) throw new Error('缺少参数 root（项目根目录）');
    // GET 过来的 deep 会是字符串（'1'/'true'），POST 过来的是布尔 —— 两种都认
    const deep = params.deep === true || params.deep === 1 || params.deep === '1' || params.deep === 'true';
    return requireCore().panelCompression(root, { deep });
  },
  /** 设置页：全部旋钮 + 每个值的来源层（env > config > 默认） */
  config(params) {
    // [1021 安全轴] root 来自 HTTP 查询参数，**必须过白名单**（只认注册表里登记过的项目根）。
    //   不校验的话，这个本地端点可以被用来探任意路径（见 core/panel/snapshot.ts 的 assertRegisteredRoot 注释）。
    const root = requireCore().assertRegisteredRoot(String(params.root || ''));
    if (!root) throw new Error('缺少参数 root（项目根目录）');
    return requireCore().panelConfigView(root);
  },
  /** 写回旋钮（唯一的写路径，未知旋钮与非法值整批拒绝） */
  applyConfig(params) {
    // [1021 安全轴] root 来自 HTTP 查询参数，**必须过白名单**（只认注册表里登记过的项目根）。
    //   不校验的话，这个本地端点可以被用来探任意路径（见 core/panel/snapshot.ts 的 assertRegisteredRoot 注释）。
    const root = requireCore().assertRegisteredRoot(String(params.root || ''));
    if (!root) throw new Error('缺少参数 root（项目根目录）');
    if (!params.patch || typeof params.patch !== 'object') throw new Error('缺少参数 patch');
    return requireCore().panelApplyConfig(root, params.patch);
  },
  /** 经验层单独取（默认叠在 overview 里，这里给"只看经验"的入口） */
  lessons(params) {
    return requireCore().panelLessons(Number(params.limit) || 200);
  },
  lifecycle() { return requireCore().panelLifecycle(); },
  /** [1021] 知识图谱：新鲜度 + 枢纽标签（**不画力导向图**，理由见 core/panel/snapshot.ts 的 panelGraph 注释） */
  graph(params) {
    // [1021 安全轴] root 来自 HTTP 查询参数，**必须过白名单**（只认注册表里登记过的项目根）。
    //   不校验的话，这个本地端点可以被用来探任意路径（见 core/panel/snapshot.ts 的 assertRegisteredRoot 注释）。
    const root = requireCore().assertRegisteredRoot(String(params.root || ''));
    if (!root) throw new Error('缺少参数 root（项目根目录）');
    return requireCore().panelGraph(root, Number(params.limit) || 20);
  },
  /** 动作清单（前端渲染按钮）+ 当前是否有动作在跑 */
  actions() {
    const { file, how } = cliPath();
    return {
      actions: ACTIONS.map((a) => ({ id: a.id, title: a.title, desc: a.desc, writes: a.writes })),
      cli: file, cliHow: how, running,
      cliHint: file ? null : '找不到内核 CLI：装 dsh-srelay-brief（它自带完整内核，含 node_modules），或用 SRELAY_CLI_PATH 指定 dist/srelay.js。'
        + ' 注意本插件自己的 vendor/dist 是**没有 node_modules** 的（面板零原生依赖），所以它不能当动作的执行体。',
    };
  },
  /** 跑一个动作。默认 dry-run；apply=true 才真写（点错一次不该毁数据） */
  async run(params) {
    const spec = ACTIONS.find((a) => a.id === params.op);
    if (!spec) throw new Error('不在白名单里的动作：' + String(params.op));
    if (spec.writes && params.apply !== true) {
      throw new Error('「' + spec.title + '」是写操作，而且它**没有演练模式** —— 要跑就勾上"真的写"（想先看结果：去「压缩」页开全量干跑测量）');
    }
    if (running) throw new Error('已经有一个动作在跑（' + running + '），等它结束');
    running = spec.id;
    try { return await runCli(spec.argv, { apply: params.apply === true }); }
    finally { running = null; }
  },
  /** 自诊断：把"为什么没数据"直接摆出来（核心库、驱动、路由、内核 CLI） */
  diagnostics() {
    const { file, how } = cliPath();
    let driver = null, projectSample = null;
    try {
      const ov = requireCore().panelOverview({});
      driver = ov.driver;
      projectSample = ov.projects[0] ? { name: ov.projects[0].name, ok: ov.projects[0].ok, error: ov.projects[0].error } : null;
    } catch { /* 见 coreError */ }
    return {
      panelVersion: '0.1.0',
      node: process.version,
      route: ROUTE,
      routeAlias: ROUTE_ALIAS,
      vendorPanel: VENDOR_PANEL,
      coreLoaded: !!core,
      coreError,
      driver,
      projectSample,
      cli: file, cliHow: how,
      cliHint: file ? null : '装 dsh-srelay-brief 或设 SRELAY_CLI_PATH',
      uptimeSec: Math.round(process.uptime()),
    };
  },
};

function writeJson(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

async function handle(req, res, method, params) {
  const fn = METHODS[method];
  if (!fn) return writeJson(res, 404, { ok: false, error: { code: 'no-method', message: '没有这个方法：' + method } });
  try {
    const data = await fn(params);
    // 有些方法（如 applyConfig）正常返回但结论是"没写成"—— 不许把它包成 ok:true 蒙混过去
    const verdict = data && typeof data === 'object' && 'ok' in data ? data.ok === true : true;
    return writeJson(res, 200, verdict ? { ok: true, method, data } : { ok: false, method, data, error: { code: 'rejected', message: String(data.error || '被拒绝') } });
  } catch (e) {
    // 失败一定要有话说（这是"容错不许静默"的落地处）
    return writeJson(res, 200, { ok: false, method, error: { code: 'failed', message: String(e && e.message || e).slice(0, 500) }, coreError });
  }
}

function makeHandler() {
  return (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://dsh.internal');
      const prefix = url.pathname.startsWith(ROUTE_ALIAS + '/') ? ROUTE_ALIAS
        : url.pathname.startsWith(ROUTE + '/') ? ROUTE : null;
      if (!prefix) return writeJson(res, 404, { ok: false, error: { code: 'no-route', message: '未知路径' } });
      const method = url.pathname.slice(prefix.length + 1);
      if (!method || method.includes('/')) {
        return writeJson(res, 404, { ok: false, error: { code: 'no-method', message: '方法名不对：' + method } });
      }
      const q = Object.fromEntries(url.searchParams.entries());
      if (req.method === 'GET') return handle(req, res, method, q);
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: { code: 'method-error', message: '只支持 GET/POST' } });
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 256 * 1024) req.destroy(); });
      req.on('end', () => {
        let params = {};
        try { params = body ? JSON.parse(body) : {}; }
        catch { return writeJson(res, 400, { ok: false, error: { code: 'bad-json', message: '请求体不是 JSON' } }); }
        handle(req, res, method, { ...q, ...params });
      });
      return undefined;
    } catch (e) {
      return writeJson(res, 500, { ok: false, error: { code: 'server', message: String(e && e.message || e).slice(0, 300) } });
    }
  };
}

export function apply(ctx) {
  bootLog('apply() 被调用');
  try {
  const server = ctx.webServer;
  if (!server || typeof server.register !== 'function') {
    // 不静默：这条日志是"路由为什么 404"的唯一线索
    bootLog('ABORT · webServer 不可用（typeof=' + typeof server + '）');
    console.error('[srelay-panel] webServer 服务不可用，路由没有注册（' + ROUTE + '）');
    return;
  }
  const handler = makeHandler();
  for (const p of [ROUTE, ROUTE_ALIAS]) {
    try {
      ctx.effect(() => server.register({ kind: 'prefix', path: p, handler }), 'dsh-srelay-panel: ' + p);
      bootLog('route ok · ' + p);
    } catch (err) {
      bootLog('ROUTE FAILED · ' + p + ' :: ' + String(err && err.stack || err));
      throw err;
    }
  }
  // 命名服务：同进程的其他插件不必走 HTTP（与 better-sidebar 的 ctx.provide 同一形态）
  if (typeof ctx.provide === 'function') {
    try {
      ctx.provide('sessionrelay', {
        id: PANEL_ID,
        route: ROUTE,
        ...METHODS,
      });
    } catch (e) {
      console.error('[srelay-panel] ctx.provide("sessionrelay") 失败：' + String(e && e.message || e));
    }
  } else {
    console.error('[srelay-panel] 这个 ctx 没有 provide()，命名服务没有发布（HTTP 路由仍然可用）');
  }
  if (!core) { console.error('[srelay-panel] ' + coreError); bootLog('core 不可用 · ' + coreError); }
  bootLog('apply() 全部完成');
  } catch (e) {
    bootLog('APPLY THREW :: ' + String(e && e.stack || e));
    throw e;
  }
}

export { VENDOR_PANEL, ACTIONS };
