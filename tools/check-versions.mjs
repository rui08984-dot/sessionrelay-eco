#!/usr/bin/env node
// check-versions.mjs — 一键核对 SessionRelay 全部副本是否同一版本
//
// 为什么需要它：这套系统有 5 份 CLI 运行时 + 5 份插件源码，任何一份落后都会造成
// 「静默半失效」——最惨的一次是部署态 vendor 停在 10-13，建出来的库 sources 缺 dsh，
// DSH 会话永远采不进去，而库/守护/status 看起来全都正常，零报错。
//
// 权威源（唯一）：
//   核心库源码 D:\dsh插件  记忆\core\SessionRelay\src
//     → npm run build 产出 dist/
//     → vendor-srelay.mjs --from <核心库> 产出插件 vendor/
//     → 复制到 web/desktop 两个 profile
//     → 全局 npm 安装（ZCode hook 与 headless 回落都用它）
//   插件源码权威源：D:\dsh插件  记忆\plugins\dsh\
//     → 复制到 integrations/dsh（上游）与三个 profile
//
// 用法：node check-versions.mjs          （人读）
//       node check-versions.mjs --quiet  （只在有问题时输出，适合挂 guard）
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
// G 段要直接读各项目库的概况：用内置 node:sqlite（Node ≥22.5）。取不到就把 G 段的统计降级。
let _DatabaseSync = null
try { ({ DatabaseSync: _DatabaseSync } = await import('node:sqlite')) } catch { /* 老 Node：G 段仍会打印看板与体积 */ }
import { pathToFileURL, fileURLToPath } from 'node:url'

// [B3] 一次性探针会话的判据：从核心库构建产物取（**不另写一套** —— 判据只有一处）
let PROBE_SQL = '(1=0)'
// [红队第二轮 P2] 项目候选列表也从内核取 —— 否则守门要自己拼 ~/.sessionrelay-registry，
// 那就是「判据第二份」。取不到就退回空数组（第三节会回退到 cwd）。
let registryCandidates = () => []
try {
  const coreEntry = await import(pathToFileURL(path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'core/SessionRelay/dist/recall.js')).href)
  if (typeof coreEntry.PROBE_SQL === 'string') PROBE_SQL = coreEntry.PROBE_SQL
  if (typeof coreEntry.registryCandidates === 'function') registryCandidates = coreEntry.registryCandidates
} catch { /* 核心库没构建：退化为"不排除任何会话"，本节只是通报 */ }

const ROOT = 'D:/dsh插件  记忆'
const HOME = process.env.USERPROFILE || process.env.HOME

const CLI_COPIES = [
  ['核心库 dist', path.join(ROOT, 'core/SessionRelay/dist')],
  ['插件 vendor（作者副本）', path.join(ROOT, 'plugins/dsh/vendor/dist')],
  ['全局 npm 安装', path.join(HOME, 'AppData/Roaming/npm/node_modules/@ewanjasper/sessionrelay/dist')],
  ['部署 web profile', path.join(HOME, '.dsh/profiles/web/local-plugins/dsh-srelay-brief/vendor/dist')],
  ['部署 desktop profile', path.join(HOME, '.dsh/profiles/desktop/local-plugins/dsh-srelay-brief/vendor/dist')],
]

const PLUGIN_COPIES = [
  ['插件作者副本', path.join(ROOT, 'plugins/dsh')],
  ['上游 integrations', path.join(ROOT, 'core/SessionRelay/integrations/dsh')],
  ['部署 web profile', path.join(HOME, '.dsh/profiles/web/local-plugins/dsh-srelay-brief')],
  ['部署 desktop profile', path.join(HOME, '.dsh/profiles/desktop/local-plugins/dsh-srelay-brief')],
  ['部署 headless profile', path.join(HOME, '.dsh/profiles/headless/local-plugins/dsh-srelay-brief')],
]

// [1021 审查 #17] 补上 src/hooks.mjs：此前它不在清单里 ⇒ _mirror_plugin.mjs 从权威源覆盖回旧版本
// 也查不出来（B 段"5 份完全一致"字面上绿，实际 hooks 内容早已分叉）。判据必须覆盖被判断的对象。
const PLUGIN_FILES = ['index.js', 'project-resolve.mjs', 'selftest.mjs', 'src/brief-sql.mjs', 'src/tools.js', 'src/state.js', 'src/cli.js', 'src/define-tool.js', 'src/root-rules.mjs', 'src/hooks.mjs']

function md5File(p) {
  try { return createHash('md5').update(fs.readFileSync(p)).digest('hex') } catch { return null }
}
function dirMd5(dir) {
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()
  if (!files.length) return null
  const h = createHash('md5')
  for (const f of files) h.update(fs.readFileSync(path.join(dir, f)))
  return h.digest('hex')
}
const quiet = process.argv.includes('--quiet')
const say = (...a) => { if (!quiet) console.log(...a) }
let problems = 0

say('══════ A. srelay CLI 运行时（5 份，应完全相同）══════')
const cliMd5 = {}
for (const [label, dir] of CLI_COPIES) {
  const m = dirMd5(dir)
  cliMd5[label] = m
  const ok = m ? '' : '  ← 缺失！'
  if (!m) problems++
  say(`  ${m ? m.slice(0, 16) : '（无）'}  ${label}${ok}`)
}
const cliVals = [...new Set(Object.values(cliMd5).filter(Boolean))]
if (cliVals.length > 1) {
  problems++
  say(`  🔴 不一致：${cliVals.length} 个不同版本。权威源=核心库 dist，重新生成 vendor 并同步部署副本`)
} else if (cliVals.length === 1) {
  say(`  ✅ 5 份完全一致`)
}

say('')
say('══════ B. 插件源码（5 份，逐文件应完全相同）══════')
const base = PLUGIN_COPIES[0][1]
for (const f of PLUGIN_FILES) {
  const ref = md5File(path.join(base, f))
  const bad = []
  for (const [label, dir] of PLUGIN_COPIES.slice(1)) {
    const m = md5File(path.join(dir, f))
    if (m !== ref) bad.push(label + (m ? '' : '(缺文件)'))
  }
  if (bad.length) { problems++; say(`  🔴 ${f}: 不一致 → ${bad.join(', ')}`) }
  else say(`  ✅ ${f}`)
}

say('')
// ⚠️ 下面检测用的模式是 *srelay.js*watch*（中间**不写死空格**）：守护命令行有两种形态——
//    node …\dist\srelay.js watch …   /   node "…\dist\srelay.js" watch …
// 写死带空格的版本判不出带引号启动的守护 → 假报"没有守护进程在跑（采集停摆）"。
// 1017 实测：守护 pid 58352/67776 明明在跑，这里报 0 个；生命周期驱动用的是宽容版。
say('══════ C. 守护进程是否在跑当前磁盘代码 ═══')
// ── [1021] 判据换成**项目锁**，不再靠 PowerShell 进程表 ──
//
// 病历（这段注释原本就写着）：1017 实测守护 pid 58352/67776 明明在跑，这里却报 0 个 →
//   「假报没有守护进程在跑（采集停摆）」。当时的修法是放宽命令行匹配模式，**但根子没动**：
//   靠 `Get-CimInstance` + 命令行字符串匹配本来就脆（引号、npx 包装、进程名大小写、执行策略都可能变）。
//
// 1021 又复现了一次：守护 pid 44424 锁心跳 3 秒、watch.log 还在滚，本节照样报「没有守护进程在跑」。
//   ⇒ 现在改用**守护自己写的锁文件**判活（pid 存活 + 心跳新鲜），这是唯一权威信号；
//   PowerShell 只用来**补充**「启动时间 vs 构建时间」这一项（那确实需要进程表）。
const lockAlive = (() => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.sessionrelay', 'lock'), 'utf8'))
    const age = Date.now() - Number(j.heartbeat)
    let up = false
    try { process.kill(Number(j.pid), 0); up = true } catch { up = false }
    return { ok: up && age < 60_000, pid: j.pid, ageSec: Math.round(age / 1000), up }
  } catch { return { ok: false } }
})()
try {
  const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*srelay.js*watch*\' } | ForEach-Object { $_.ProcessId.ToString() + \'|\' + $_.CreationDate.ToString(\'yyyy-MM-dd HH:mm:ss\') }"', { encoding: 'utf8' })
  const lines = out.trim().split('\n').filter(Boolean)
  // ── [1021 二次修] 加**第三个信号：真实采集结果** ──
  //
  // 病历（刚现场撞到的）：DSH 插件修好 hooks 之后，#17 那条路真的开始采集了 ——
  //   于是本机出现「没有 srelay watch 进程、项目锁心跳也冻着，但消息在正常入库」的形态，
  //   C 段照样报「采集停摆」🔴。这已是同一类病的第 5 次：
  //   **判据（有没有那个进程）没覆盖被判断的对象（采集有没有在工作）**。
  //   我们要的答案是"记忆有没有在进"，不是"有没有一个叫 watch 的进程"。
  // 判据：近 30 分钟内有过入库 ⇒ 采集活着，不管是谁干的（独立守护 / 宿主内 hooks / serve 侧同步）。
  // [红队第二轮 P1+P2 修] 原来这段有两个错，叠起来等于**没修**：
  //   P1: 在 .mjs 里写 require('node:sqlite') → ReferenceError，被自己的 catch 吞成 null。
  //       讽刺的是本文件顶部 :24-25 早就 await import 拿到了 _DatabaseSync，这里没用。
  //   P2: 读 process.cwd() 的库。但 ses-rebuild 以**仓库根**为 cwd 跑守门，
  //       于是它读的是仓库自己的库（实测 7 小时没入库），而 hooks 真正写的是当前项目库。
  //       ⇒ 口径与被判断对象无关，第三信号在正式入口下恒 false。
  // 正解：用顶部的 _DatabaseSync；把「最近的入库」定义成**登记表里所有项目库的最新一条**
  //   —— 这才等于用户真正问的那句"记忆有没有在进"。
  const recentIngest = (() => {
    if (!_DatabaseSync) return null
    let roots = []
    try { roots = registryCandidates().map((c) => c.root) } catch { return null }
    if (!roots.length) roots = [process.cwd()]
    let best = -Infinity
    for (const r of roots) {
      try {
        const f = path.join(r, '.sessionrelay', 'relay.sqlite')
        if (!fs.existsSync(f)) continue
        const db = new _DatabaseSync(f, { readOnly: true })
        try {
          const row = db.prepare('SELECT MAX(created_at) AS m FROM messages').get()
          const t = row && row.m ? Date.parse(String(row.m)) : NaN
          if (Number.isFinite(t) && t > best) best = t
        } finally { try { db.close() } catch { /* 已关 */ } }
      } catch { /* 单个库坏了不影响其它 */ }
    }
    if (!Number.isFinite(best)) return null
    return { agoMin: Math.round((Date.now() - best) / 60000), projects: roots.length }
  })()
  const ingestAlive = !!(recentIngest && recentIngest.agoMin <= 30)
  if (!lines.length && !lockAlive.ok && !ingestAlive) {
    problems++; say('  🔴 采集没有在跑（进程表、锁心跳、近 30 分钟入库 —— 三者都没有）')
  } else if (!lines.length && !lockAlive.ok && ingestAlive) {
    say(`  ✅ 采集在跑：宿主内采集（${recentIngest.projects} 个项目里最近 ${recentIngest.agoMin} 分钟有入库；无独立 watch 进程、锁心跳不动 —— DSH 插件 hooks 接管的正常形态）`)
  }
  else if (!lines.length) say(`  ✅ 守护在跑：pid ${lockAlive.pid}（锁心跳 ${lockAlive.ageSec}s，进程表查询没匹配到，以锁为准）`)
  for (const l of lines) {
    const [pid, created] = l.trim().split('|')
    const newest = CLI_COPIES.map(([, d]) => { try { return fs.statSync(path.join(d, 'srelay.js')).mtimeMs } catch { return 0 } }).sort((a, b) => b - a)[0]
    const started = new Date(created.replace(' ', 'T')).getTime()
    const stale = started < newest
    if (stale) problems++
    say(`  ${stale ? '🔴' : '✅'} pid ${pid} 启动于 ${created}${stale ? ' ← 早于最新构建，跑的是旧代码' : ''}`)
    // 说清楚"怎么才会变新"：这台机器上的守护由计划任务 SessionRelayGuard 管，而它只在**状态坏了**时才重启
    // （健康判断=恰一个 --global 实例 + fork 包在场）。所以代码更新后它不会自己换——要立刻生效就杀进程，
    // 下次登录/计划任务触发时守卫会拉起一个跑新代码的。不写这句，接手者会以为它会自愈。
    if (stale) say('     → 立刻生效：结束该进程后等守卫拉起（计划任务 SessionRelayGuard，登录时/每 4h 检查）；不重启则下次登录自动换新')
  }
} catch { say('  （查询失败）') }

say('')
say('══════ C2. DSH 侧插件：运行中的进程是否在跑当前代码（10-15 夜补）══════')
// 为什么补这一项：C 项只查**采集守护**（srelay watch）。而"今天做的简报改动根本看不见"
// 这件事此前没人查。10-15 夜实测：DSH 宿主 17:55:56 启动，而 DSH 简报的「看板段」（~19:00）
// 与「🗂 最近在动」（~19:30）都是之后落的盘 —— 于是运行中的会话里渲染的仍是**旧版简报**，
// 而 A–G 全绿、doctor 22 项 0 失败、插件 selftest 全 PASS。自检绿 ≠ 用户在看的那个进程是新的。
// 只提示、不计入退出码：「还没重启」不是仓库不一致，是运行态提醒（同 G 段的定位）。
try {
  // [红队第二轮 P3 修] 上一版「取最新启动」把**假红换成了假绿**：
  //   hosts 来自 Get-Process 的**全部** *DeepSeek* 进程（实测 10 个），而我们的工具调用
  //   每几秒就在 spawn 新的 dsh-subprocess —— 它们启动时间永远比插件改动新，
  //   于是「宿主还在跑旧代码」这个真问题**再也不会报出来**。
  //   按命令行动机过滤还不够（:02 实测仍剩 4 个）。真正的判据是**进程树**：
  //   用户启动的宿主主进程，其父进程不是 DSH 自己（是 explorer.exe / 终端 / 计划任务）。
  //   实测：59596(父=explorer) 01:49:47 才是宿主；02:14/02:15 那些都是它的孙子。
  const out2 = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like \'*DeepSeek*\' -and $_.CommandLine -notmatch \'--type=\' } | ForEach-Object { $_.ProcessId.ToString() + \'|\' + $_.CreationDate.ToString(\'yyyy-MM-dd HH:mm:ss\') + \'|\' + $_.Name + \'|\' + $_.ParentProcessId }"', { encoding: 'utf8' })
  const hostLines = out2.trim().split(/\r?\n/).filter(Boolean)
  if (!hostLines.length) { say("  ⚪ 没检测到 DSH 宿主进程（headless/未开 GUI）——跳过") }
  else {
    // 插件真实加载路径里的最新 mtime：作者副本 + .pnpm 两份（DSH 真正加载的那两份）
    const plugDirs = [path.join(ROOT, "plugins/dsh")]
    for (const prof of ["web", "desktop"]) {
      const base2 = path.join(HOME, `.dsh/profiles/${prof}/node_modules/.pnpm`)
      if (!fs.existsSync(base2)) continue
      for (const d2 of fs.readdirSync(base2)) {
        const cand2 = path.join(base2, d2, "node_modules", "dsh-srelay-brief")
        if (fs.existsSync(path.join(cand2, "index.js"))) plugDirs.push(cand2)
      }
    }
    let newest = 0, newestF = ""
    for (const d2 of plugDirs) for (const f2 of PLUGIN_FILES) {
      try { const m2 = fs.statSync(path.join(d2, f2)).mtimeMs; if (m2 > newest) { newest = m2; newestF = f2 } } catch { /* 缺文件由 B/E 段报 */ }
    }
    // [1021 修] 取**最新**启动的那个，不是最早的。
    // 病历：原来取最早 ⇒ 只要机器上留着一个上上个世代的僵留进程，就会永远报
    //   「宿主启动早于插件改动，可能仍在跑旧版」——**用户明明重启过了也照样警告**。
    //   长期假警告比没警告更糟：它训练人忽略这一行，真出事时也不会看。
    // 判据：用户重启后，**当前在跑的那个宿主**是最新起来的；旧进程要么已退出、
    //   要么是没被回收的残留，都不代表"用户现在看到的那份代码"。
    const all = []
    for (const l2 of hostLines) {
      const [pid2, started2, pname2, ppid2] = l2.trim().split("|")
      const st2 = new Date(String(started2).replace(" ", "T")).getTime()
      if (Number.isFinite(st2)) all.push({ pid: pid2, start: st2, at: started2, name: pname2, ppid: ppid2 })
    }
    // 根 = 父进程不在这批 DSH 进程里的那些（用户/explorer/终端拉起来的）
    const pidSet = new Set(all.map((x) => x.pid))
    const roots = all.filter((x) => !pidSet.has(x.ppid))
    const hosts = roots.length ? roots : all
    if (hosts.length) {
      hosts.sort((a, b) => a.start - b.start)
      const h0 = hosts[hosts.length - 1]          // 最新启动的那个**根** = 当前宿主
      const oldest = hosts[0]
      const stale2 = Number.isFinite(newest) && newest > h0.start
      say(`  ${stale2 ? "⚠️ " : "✅"} DSH 宿主启动于 ${h0.at}（${h0.name} pid ${h0.pid}；同名进程共 ${all.length} 个，其中根进程 ${roots.length} 个）`)
      const fmtLocal = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` }
      say(`     插件最新改动：${fmtLocal(newest)}（${newestF}）`)
      if (stale2) say("     → 早于插件改动：**运行中的 DSH 可能仍在渲染旧版简报**；重启 DSH 后再核对 📋 看板 与 🗂 行")
    } else { say("  ⚪ 读不到 DSH 进程启动时间——跳过") }
  }
} catch { say('  （查询失败，跳过）') }

say('')
say('══════ D. 各项目采集源是否含 dsh ═══')
const regFile = path.join(HOME, '.sessionrelay-registry/projects.json')
try {
  const reg = JSON.parse(fs.readFileSync(regFile, 'utf8'))
  const dshExists = fs.existsSync(path.join(HOME, '.dsh/sessions'))
  for (const p of reg.projects || []) {
    const cfg = path.join(p.root, '.sessionrelay/config.json')
    if (!fs.existsSync(cfg)) { say(`  ⚪ ${p.root}（无 config，跳过）`); continue }
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'))
    const src = j?.capture?.sources ?? []
    const bad = dshExists && !src.includes('dsh')
    if (bad) problems++
    say(`  ${bad ? '🔴' : '✅'} ${p.root} → ${JSON.stringify(src)}${bad ? ' ← 缺 dsh，DSH 会话采不进去' : ''}`)
  }
} catch { say('  （读不到注册表）') }

// ══════════════════════════════════════════════════════════════════════════
// E/F 两项是 2026-10-15 补的——**当天真出过事故**：
//   A 项与 B 项全绿，而 DSH 侧插件在真实加载路径上 `ERR_MODULE_NOT_FOUND`，
//   记忆注入整条失效。两个盲区：
//     ① B 项比的是**硬编码文件清单**（PLUGIN_FILES）——新增文件不在清单里，于是'一致'；
//     ② 全程没查 **.pnpm 副本**，而 DSH 实际加载的就是它（pnpm 的 file: 依赖是硬链接：
//        原地改的老文件会同步，**新增文件不会进 .pnpm**）。
// ══════════════════════════════════════════════════════════════════════════

say('')
say('══════ E. 插件副本文件集一致性（含 .pnpm 真实加载路径）══════')
const pnpmCopy = (profile) => {
  const nm = path.join(HOME, `.dsh/profiles/${profile}/node_modules/.pnpm`)
  try {
    const d = fs.readdirSync(nm).find((x) => x.startsWith('dsh-srelay-brief@'))
    return d ? path.join(nm, d, 'node_modules/dsh-srelay-brief') : null
  } catch { return null }
}
const FILE_SET_COPIES = [
  ...PLUGIN_COPIES,
  ['web .pnpm 副本（DSH 真正加载的）', pnpmCopy('web')],
  ['desktop .pnpm 副本（DSH 真正加载的）', pnpmCopy('desktop')],
]
const SKIP_WALK = new Set(['node_modules', '.git'])
const walkFiles = (dir, base = '') => {
  const out = []
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    if (SKIP_WALK.has(e.name)) continue
    const rel = base ? base + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...walkFiles(path.join(dir, e.name), rel))
    else out.push(rel)
  }
  return out
}
const authorSet = walkFiles(base)
for (const [label, dir] of FILE_SET_COPIES) {
  if (!dir) { problems++; say(`  🔴 ${label}: 目录不存在`); continue }
  const have = new Set(walkFiles(dir))
  const missing = authorSet.filter((f) => !have.has(f))
  const extra = [...have].filter((f) => !authorSet.includes(f))
  if (missing.length || extra.length) {
    problems++
    say(`  🔴 ${label}`)
    if (missing.length) say(`      副本缺 ${missing.length} 个文件：${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}`)
    if (extra.length) say(`      副本多 ${extra.length} 个文件（陈旧残留）：${extra.slice(0, 6).join(', ')}${extra.length > 6 ? ' …' : ''}`)
  } else {
    say(`  ✅ ${label}（${authorSet.length} 个文件逐一对齐）`)
  }
}

// G：各项目记忆库概况（2026-10-15 夜加）
// 回答的问题：我这几个项目到底有没有在用记忆？哪个项目的简报是空的？
//   ① 有没有看板 progress.md（没有 ⇒ 简报永远没有「计划/下一步」；b3 实测这一维只捕获 3.3%）
//   ② 库里有多少会话/决策（太少 ⇒ 疑似测试残留，可删）
//   ③ 库的提取规则版本（落后 ⇒ 历史数据还是旧规则算的）
say('')
say('══════ G. 各项目记忆库概况（看板 / 会话 / 决策 / 体积 / 规则版本）══════')
say('  （本节是概况通报，不计入退出码——只有 A–F 的一致性问题才判红）')
try {
  const reg = JSON.parse(fs.readFileSync(regFile, 'utf8'))
  for (const p of reg.projects || []) {
    const root = p.root
    const kp = path.join(root, 'progress.md')
    let kanban = '无看板'
    if (fs.existsSync(kp)) {
      try {
        const kt = fs.readFileSync(kp, 'utf8')
        const rows = kt.split(/\r?\n/).map((l) => l.split('|').map((s) => s.trim()))
          .filter((c) => c.length >= 5 && /^[✅🔄⛔⬜]/u.test(c[2] ?? '') && /[🔄⛔]/u.test(c[2] ?? ''))
        kanban = rows.length + '行进行中/阻塞'
      } catch { kanban = '看板读取失败' }
    }
    const dbp = path.join(root, '.sessionrelay', 'relay.sqlite')
    let sess = 0, dec = 0, mb = 0, ver = 0, winN = 0, winSess = 0, winMax = 0, revivedN = 0, revivedDec = 0, probeN = 0
    if (fs.existsSync(dbp) && _DatabaseSync) {
      mb = Math.round(fs.statSync(dbp).size / 1024 / 1024)
      try {
        const d = new _DatabaseSync(dbp, { readOnly: true, timeout: 5000 })
        sess = d.prepare('SELECT COUNT(*) AS n FROM sessions').get().n ?? 0
        // [B3] 一次性探针会话数：判据来自核心库（recall.js 的 PROBE_SQL），这里不另写一套
        try { probeN = d.prepare('SELECT COUNT(*) AS n FROM sessions s WHERE ' + PROBE_SQL).get().n ?? 0 } catch { probeN = 0 }
        for (const r of d.prepare("SELECT decisions FROM sessions WHERE decisions IS NOT NULL AND decisions != '[]'").all()) {
          try { dec += JSON.parse(r.decisions).length } catch { /* 坏 JSON 跳过 */ }
        }
        try { ver = d.prepare('SELECT version FROM extract_meta WHERE id = 1').get()?.version ?? 0 } catch { ver = 0 }
        // [1015 夜] 窗内候选的**集中度**：48h 内决策来自几场会话、最大一场占多少。
        // 为什么量它：实测主库 48h 窗内 16 条候选里 11 条来自**同一场会话**（标题是别的项目的交接文档路径），
        // 而简报只显示 4 条 ⇒ 那 4 条全是这场会话说的。**任何过滤器都治不了这个**（窗内没有更好的东西可顶上来），
        // 但必须让它可见——否则使用者只会觉得「简报怎么全是没用的」。
        try {
          const cut = new Date(Date.now() - 48 * 3600000).toISOString()
          const per = new Map()
          for (const r of d.prepare("SELECT id, decisions, created_at FROM sessions WHERE decisions IS NOT NULL AND decisions != '[]'").all()) {
            let n = 0
            try { for (const it of JSON.parse(r.decisions)) { if (Date.parse(it.at || r.created_at) >= Date.parse(cut)) n++ } } catch { /* 坏 JSON */ }
            if (n) per.set(r.id, n)
          }
          winN = [...per.values()].reduce((a, b) => a + b, 0)
          winSess = per.size
          winMax = per.size ? Math.max(...per.values()) : 0
        } catch { /* 取不到就留 0 */ }
        // [1015 夜] 归档后复活的会话：cleanup_at 被清空（sync.ts:245-248），但决策骨架来自**已被删除的消息**。
        // 这类会话会被 recompute 选中（confirmed + cleanup_at NULL + message_count>0），而重算只能从
        // 「残存的新消息」里重抽 ⇒ **骨架会被换掉**。
        // 实测（判据修正为 > 0 之后）：三库归档过 373/229/82 场，**但一场都还没复活** ⇒ 潜伏风险、非活跃故障；
        // recompute.ts 的自动合并已就位防将来（骨架保留 + 新消息照抽）。
        // 只让它可见——改不改选取条件是设计决策，留给用户拍板。（⚠️ 必须在 d.close() 之前，否则被 catch 静默吞掉。）
        try {
          // ⚠️ `> 0` 而非 IS NOT NULL：该列 DDL 默认 0，写错会把全部会话都算成复活过（实测踩过）
          for (const r of d.prepare('SELECT decisions FROM sessions WHERE cleanup_at IS NULL AND original_message_count > 0').all()) {
            revivedN++; try { revivedDec += JSON.parse(r.decisions || '[]').length } catch { /* 坏 JSON */ }
          }
        } catch { /* 老库没这列 */ }
        d.close()
      } catch { /* 读不到就留 0 */ }
    }
    const flags = []
    if (kanban === '无看板') flags.push('缺看板')
    if (sess > 0 && sess < 5) flags.push('疑似测试残留')
    if (ver && ver < 17) flags.push('规则版本 v' + ver)
    // 素材太薄才提示（窗内条目少、又只来自极少数会话 ⇒ 4 个名额没有挑选余地）。
    // 注意这是**原始窗**的集中度，不是过完过滤链之后的——后者要点亮整条链，代价不值。
    if (winN >= 6 && winSess <= 3) flags.push(`窗内素材薄：${winN} 条只来自 ${winSess} 场`) 
    if (revivedN) flags.push(`复活过 ${revivedN} 场（骨架 ${revivedDec} 条）`)
    const probeTag = probeN > 0 ? ` （探针 ${probeN}）` : ''
    say(`  ${flags.length ? '⚠️ ' : '✅'} ${root.padEnd(34)} ${kanban.padEnd(16)} ${String(sess).padStart(4)} 会话${probeTag} ${String(dec).padStart(5)} 决策 ${String(mb).padStart(3)}MB v${ver} 窗内${String(winN).padStart(3)}条/${String(winSess).padStart(2)}场${flags.length ? '  ← ' + flags.join(' / ') : ''}`)
  }
} catch { say('  （读不到注册表）') }


// H：「最近在动」两侧同规对拍（2026-10-15 夜加，随 srelay brief 一起上的）
// 为什么加 H：这个功能现在有**两份实现**——插件走 node:sqlite 直查（0 子进程），
// 核心库走 better-sqlite3（给 ZCode 的一次取数用）。两个运行时不能共用模块，
// 各自的单测只能测自己的口径，**两侧漂了没人知道**，症状是两个客户端显示不同的文件集合。
// 所以拿真实库、拿对方的输出对拍（只比前 3 名，即简报真正显示的那部分）。
say('')
say('══════ H. 「最近在动」两侧同规（核心库 listRecentFiles vs DSH 插件 queryRecentFiles）══════')
try {
  const plug = await import(pathToFileURL(path.join(ROOT, 'plugins/dsh/src/brief-sql.mjs')).href)
  const cliPath = path.join(ROOT, 'core/SessionRelay/dist/srelay.js')
  for (const r2 of ['D:/agent1super', 'E:/music player']) {
    let fromCli = null
    try {
      const out = execSync('"' + process.execPath + '" "' + cliPath + '" brief --json --limit 1', { cwd: r2, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      fromCli = JSON.parse(out).recentFiles
    } catch (e) {
      // ⚠️ [1021 后端红队 #4] 这里原本是 `catch { say('⚪ ...跳过'); continue }` —— **跳过不计入 problems**。
      //   实测后果（15:42:15Z）：dist 正在重建，`dist/brief-KLBQMTFZ.js` 一时不存在，
      //   两个项目各抛 ERR_MODULE_NOT_FOUND 被跳过，最后门禁照样打印「✅ 全部一致」EXIT=0；
      //   24 秒后重跑同样的命令变 ✅ —— **同一磁盘同一条命令两次结论不同，而第一次是绿的**。
      //   这比红更糟：红会让人去查，假绿会让人以为没问题。
      //   现在：跳过 = 「没验成」= 算失败。要么这次真的有结论，要么就别报绿。
      problems++
      say('  🔴 ' + r2 + '：CLI 的 brief 命令**没跑成**，本节未验证（' + String((e && e.message) || e).slice(0, 80) + '）')
      continue
    }
    let fromPlug = null
    try { fromPlug = plug.queryRecentFiles(r2, { days: 7, top: 3 }) } catch (e) { say('  ⚪ ' + r2 + '：插件侧取数失败 ' + String(e && e.message).slice(0, 60)) ; continue }
    // ⚠️ [1017 夜 08:1x] 修一条长期假红（实测：连跑 6 次红 2 次）。
    //   本节拿**核心 CLI** 与**插件 SQL** 两路分别取一次「最近在动」，而采集守护可能正好在两次读之间
    //   写库（实测抓到 providers.json sessions 38→39、decisions 101→103）。
    //   ⇒ 「数据在动」被误判成「两份实现漂移」，症状是「没改任何代码却报 DSH 与 ZCode 会显示不同文件集合」。
    //
    // 修法**不放松判据**（与 8c 同一套纪律）：判据仍是「两边必须逐字节相同」，
    //   只是**先比对库指纹**：两次取数之间数据动过就 SKIP 并说清原因，没动才照旧判。
    //   不修的话假红会让下一个人直接删掉这条断言 —— 那比没有这条断言更糟。
    // ⚠️⚠️ [独立复审后重写 08:5x] 第一版这个守卫有三处**静默假绿**，复审全中，实测复核后重写：
    //
    //  ❶ 指纹漏掉派生列重写：`db.ts:668` 的 refresh/confirm 重算是
    //     `UPDATE sessions SET files_mentioned=?, topics=?, decisions=?, key_questions=?, ...`
    //     **不动 last_event_at、不插 messages、不增 sessions 数** ⇒ 旧指纹逐字恒等，
    //     而 `brief-sql.mjs:246-279` 的「最近在动」正是从 files_mentioned + decisions 排序出来的
    //     ⇒ 守卫不触发，判定却用两份不同快照。**必须把这两列并进指纹。**
    //  ❷ 窗口错位：第一版 `fromPlug` 取于 st1 之前，判定却拿它跟 st1 之后的 fromCli2 比，
    //     t1→t2 之间**裸奔**。⇒ 改成 **stamp / 两路取数 / stamp** 严格夹住，两份快照都在窗口内。
    //  ❸ `n/a` 静默放行：`stamp()` 异常返回 `n/a`，而判定条件是 `st1 !== 'n/a'`
    //     ⇒ node:sqlite 不可用时守卫**从不触发**，整节一路绿。⇒ 现在这种情况**直接判红并说清**。
    //  ❹ [第三轮复审 09:1x] 上面那条仍漏了一整类：`brief-sql.mjs:245-249` 的 PROBE 过滤用的是
    //     **四列** —— `message_count`、`origin`、`decisions`、`key_questions`，
    //     而前五项指纹**一项都不含** `message_count`/`origin`/`key_questions`。
    //     最要命的是 `db.ts:414` 的 `bumpMessageCount`：
    //       `UPDATE sessions SET message_count = message_count + ? WHERE id = ?`
    //     **每捕获一条消息就跑一次**，只写这一列 ⇒ 五项逐字恒等，
    //     而会话一旦从 `message_count <= 2` 跨到 3 就会**进出** PROBE，输出跟着变。
    //     另外 `decisionsLen` 是 SUM ⇒ 等量增减会归零，给上面这类写提供掩护。
    //     ⇒ 补两项：**被 PROBE 排除的会话数**（直接对应进出）+ **key_questions 总长**。
    //     负结果验证（静态临时库，可控）：只把 message_count 从 2 改成 3，
    //     前五项**逐字不变**、补充项 `excl` 2→1 ⇒ 确实能抓到。
    const STAMP_SQL = [
      'SELECT (SELECT COUNT(*) FROM sessions) s, (SELECT MAX(rowid) FROM messages) m,',
      " (SELECT MAX(last_event_at) FROM sessions) t,",
      // ❺ [第四轮复审 09:3x] 三项**内容指纹**：对**内容**取 md5，不再用 COUNT / SUM。
      //   为什么换：第四轮复审指出两处「等量抵消」——
      //     ① `nf` 只是 COUNT(files_mentioned 非空行数)，而 db.ts:663-668 的 refresh/confirm 是
      //        `JSON.stringify(meta.files)` **整体重写**该列 ⇒ 删一个文件 + 同时加一个文件
      //        ⇒ 行数不变、内容已变，而「最近在动」的聚合结果跟着变。
      //     ② `ds` / `kq` 是 SUM(LENGTH(...)) ⇒ 等量增减归零（守护批量 recompute 时是常态）。
      //   实测（库副本）：把 files_mentioned 里一个文件名换掉 ⇒ 旧七项**逐字不变**。
      //   改法：`group_concat` 按 id 排序拼全文再取 md5 —— 顺序敏感、等长也区分。
      //   实测主库 106KB 内容、6ms 完成，守门只跑两次，代价可忽略。
      " (SELECT COUNT(*) FROM sessions WHERE files_mentioned IS NOT NULL AND files_mentioned != '[]') nf,",
      " (SELECT COUNT(*) FROM sessions WHERE coalesce(message_count,0) <= 2",
      "   AND (origin IS NULL OR origin NOT IN ('manual','imported','note'))",
      "   AND (decisions IS NULL OR length(decisions) <= 2)",
      "   AND (key_questions IS NULL OR length(key_questions) <= 2)) excl",
    ].join(' ')
    // 三项内容指纹单独取：需要逐行排序 + 哈希
    const CONTENT_QUERIES = [
      ['files', "SELECT group_concat(COALESCE(files_mentioned, char(39,39)), char(10)) v FROM (SELECT files_mentioned FROM sessions ORDER BY id)"],
      ['dec', "SELECT group_concat(COALESCE(decisions, char(39,39)), char(10)) v FROM (SELECT decisions FROM sessions ORDER BY id)"],
      ['kq', "SELECT group_concat(COALESCE(key_questions, char(39,39)), char(10)) v FROM (SELECT key_questions FROM sessions ORDER BY id)"],
    ]
    const stamp = async () => {
      let db = null
      try {
        const { DatabaseSync } = await import('node:sqlite')
        db = new DatabaseSync(path.join(r2, '.sessionrelay', 'relay.sqlite'), { readOnly: true })
        const s = db.prepare(STAMP_SQL).get()
        const { createHash } = await import('node:crypto')
        const h = {}
        for (const [k, q] of CONTENT_QUERIES) {
          try { h[k] = createHash('md5').update(String(db.prepare(q).get().v ?? '')).digest('hex').slice(0, 10) } catch { h[k] = '?' }
        }
        return 'sessions=' + s.s + ' maxMsgRowid=' + s.m + ' lastEvent=' + s.t
          + ' filesRows=' + s.nf + ' probeExcluded=' + s.excl
          + ' filesMd5=' + h.files + ' decMd5=' + h.dec + ' kqMd5=' + h.kq
      } catch (e) {
        return 'n/a(' + String(e && e.message).slice(0, 40) + ')'
      } finally { if (db) { try { db.close() } catch {} } }
    }
    // ❷ 窗口：st1 → 两路取数 → st2，两份被比较的快照**都在这个区间内取得**
    // ❺ [第三轮复审 09:1x] 顺序调整：**先跑插件侧（~5ms），再跑 CLI（spawn ~190ms）**。
    //   ⚠️⚠️ [第四轮复审 09:4x 勘误我自己] 这里原来写「时间差从 ~190ms 缩到 ~5ms」是**错的**。
    //   实际：换顺序只是让**谁大谁小反了**（旧：插件 cutoff 比 CLI 晚；新：CLI 比插件晚），
    //   **绝对差仍是 ~190ms**。不写成「缩到 5ms」，免得下一个人以为这里已经解决了。
    //   原顺序是先 CLI 后插件，于是插件侧算 cutoff 的时刻比 CLI 晚 ~190ms。
    //   库指纹此时**逐字相同**（守卫不会 SKIP），一个 `last_event_at` 正好落在这 190ms 缝里的会话
    //   会被判成「两份实现已漂」—— **守卫把「库变了」和「钟走了」当成一回事**。
    //   ⇒ 两手一起做：① 顺序改成快的在前，让时间差从 190ms 缩到 ~5ms；
    //     ② 插件侧显式传 `now`（`queryRecentFiles` 新增的可选参数），让窗口可被外部钉住；
    //     CLI 侧不改对外接口（那是产品 API，不该为一条测试加 flag）。
    //   剩下的残余时间差（~5ms 量级）由 ❹ 的指纹继续兜：真有会话跨线，指纹会变并 SKIP。
    const st1 = await stamp()
    const nowFixed = Date.now()
    let fromCli2 = null, fromPlug2 = null, readFail = ''
    try { fromPlug2 = plug.queryRecentFiles(r2, { days: 7, top: 3, now: nowFixed }) } catch (e) { readFail = '插件二次取数失败 ' + String(e && e.message).slice(0, 40) }
    try {
      const out2 = execSync('"' + process.execPath + '" "' + cliPath + '" brief --json --limit 1', { cwd: r2, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      fromCli2 = JSON.parse(out2).recentFiles
    } catch (e) { readFail = (readFail || '') + 'CLI 二次取数失败 ' + String(e && e.message).slice(0, 40) }
    const st2 = await stamp()
    // ❸ 指纹取不到 ⇒ 判红并说清，**不再静默放行**（第一版这里是假绿的源头）
    if (st1.startsWith('n/a(') || st2.startsWith('n/a(')) {
      problems++
      say('  🔴 ' + r2 + '：取库指纹失败（' + st1 + '），无法证明两次取数之间数据没变 —— **本节不下结论**')
      say('       （不是「没问题」，是「没验成」。node:sqlite 不可用时第一版会一路绿，属静默假绿。）')
      continue
    }
    if (readFail) { problems++; say('  🔴 ' + r2 + '：' + readFail + ' —— **本节不下结论**'); continue }
    if (st1 !== st2) {
      say('  ⚠️ ' + r2 + '：两次取数之间采集守护写库了（指纹 ' + st1 + ' → ' + st2 + '）——跳过本项目，不下结论')
      continue
    }
    fromCli = fromCli2; fromPlug = fromPlug2
    const same = JSON.stringify(fromCli2) === JSON.stringify(fromPlug)
    if (!same) problems++
    say('  ' + (same ? '✅' : '🔴') + ' ' + r2 + ' → ' + JSON.stringify(fromCli2) + (same ? '' : '\n       ≠ 插件 ' + JSON.stringify(fromPlug) + '\n       ← 两份实现已漂：DSH 与 ZCode 会显示不同的文件集合'))
  }
} catch (e) { say('  （对拍失败：' + String(e && e.message).slice(0, 90) + '）') }

// I 段（2026-10-15 夜新增）：技能副本一致性。
// 为什么需要：**技能是"接手者唯一入口"的元工具**，它自己漂了，后面每一次交接都跟着漂。
// 实测起因：handoff 技能在 ~/.agents/skills 与 ~/.dsh/skills 两份内容不同（md5 不一致，日期差两周）；
// 当晚把 handoff + project-atlas 合并成 handoff-atlas，退役原件——退役是否彻底、新件两份是否一致，
// 必须有人守门（否则下次会有人改一份、忘另一份，或把退役件又拷回来当独立技能加载）。
say('')
say('══════ I. 技能副本一致性（仓库 integrations/skills ⇄ 两处技能目录）══════')
try {
  const HOME2 = process.env.USERPROFILE || process.env.HOME
  const SR = path.join(HOME2, '.agents/skills')
  const DR = path.join(HOME2, '.dsh/skills')
  const MIRRORED = ['handoff-atlas']
  const RETIRED2 = ['handoff', 'project-atlas', 'state-stack']
  const md5f = (f) => createHash('md5').update(fs.readFileSync(f)).digest('hex')
  const listRel = (dir, base = dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) listRel(p, base, out) }
      else out.push(path.relative(base, p).replace(/\\/g, '/'))
    }
    return out
  }
  // 权威源 = 仓库 integrations/skills（2026-10-16 起）——技能原先只在用户目录，换机器/打离线包都会丢
  for (const name of MIRRORED) {
    const s = path.join(ROOT, 'integrations/skills', name)
    if (!fs.existsSync(path.join(s, 'SKILL.md'))) { problems++; say('  🔴 仓库权威源缺 SKILL.md: ' + s); continue }
    const sf = listRel(s).sort()
    for (const dstRoot of [SR, DR]) {
      const d = path.join(dstRoot, name)
      const label = dstRoot === SR ? '~/.agents/skills' : '~/.dsh/skills'
      if (!fs.existsSync(path.join(d, 'SKILL.md'))) { problems++; say('  🔴 ' + label + ' 缺副本: ' + d + '（跑 node tools/_mirror_skills.mjs）'); continue }
      const df = listRel(d).sort()
      const bad = []
      for (const f of sf) { const sp = path.join(s, f), dp = path.join(d, f); if (!fs.existsSync(dp) || md5f(sp) !== md5f(dp)) bad.push(f) }
      for (const f of df) if (!sf.includes(f)) bad.push(f + '(副本多余)')
      if (bad.length) { problems++; say('  🔴 ' + name + ' ⇄ ' + label + ' 不一致 → ' + bad.join(', ')) }
      else say('  ✅ ' + name + ' ⇄ ' + label + ' 一致（' + sf.length + ' 个文件）')
    }
  }
  for (const name of RETIRED2) {
    const hit = [path.join(SR, name), path.join(DR, name)].filter((p) => fs.existsSync(path.join(p, 'SKILL.md')))
    if (hit.length) { problems++; say('  🔴 已退役技能仍在技能目录（会被当独立技能加载）: ' + hit.join(' , ')) }
    else say('  ✅ ' + name + ' 已退役（两处都不在技能目录）')
  }
} catch (e) { say('  （技能副本检查失败：' + String(e && e.message).slice(0, 90) + '）') }


// J 段（2026-10-16 新增）：插件 vendor 的**依赖闭包完整性**。
// 为什么必须有这一段：实测踩到的真 bug —— vendor 生成脚本的闭包循环只扫「顶层依赖名单」，
// 于是传递依赖（@inquirer/core / ansi / figures / type 等）**永远不会被复制**，
// 而 vendor 看起来"有货"、所有自检全绿；DSH 里一调用 srelay_record 就炸在模块找不到。
// 更糟的是部署副本停在 36 个包、作者副本 121 个包——镜像工具明确排除 vendor，没人发现。
// 判据：把 vendor 里每个包的 dependencies 与"已装包集合"对一遍，缺任何一个都判红。
say('')
say('══════ J. 插件 vendor 依赖闭包（防"装了却缺件"）══════')
try {
  const HOME3 = process.env.USERPROFILE || process.env.HOME
  const vendors = [['作者副本', path.join(ROOT, 'plugins/dsh/vendor')]]
  for (const p of ['web', 'desktop', 'headless']) {
    vendors.push(['profile ' + p, path.join(HOME3, '.dsh/profiles', p, 'local-plugins/dsh-srelay-brief/vendor')])
  }
  const closureOf = (v) => {
    const nm = path.join(v, 'node_modules')
    if (!fs.existsSync(nm)) return null
    const dirs = []
    for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === '.bin') continue
      if (e.name.startsWith('@')) {
        for (const s of fs.readdirSync(path.join(nm, e.name), { withFileTypes: true })) if (s.isDirectory()) dirs.push(e.name + '/' + s.name)
      } else dirs.push(e.name)
    }
    const have = new Set(dirs)
    const missing = new Set()
    for (const d of dirs) {
      const pj = path.join(nm, d, 'package.json')
      if (!fs.existsSync(pj)) continue
      try {
        const j = JSON.parse(fs.readFileSync(pj, 'utf8'))
        for (const dep of Object.keys(j.dependencies ?? {})) if (!have.has(dep)) missing.add(dep)
      } catch { /* 坏包跳过 */ }
    }
    return { n: dirs.length, missing: [...missing] }
  }
  let ref = null
  for (const [label, v] of vendors) {
    if (!fs.existsSync(v)) { say('  ⚪ ' + label + '：无 vendor（未装/未生成）'); continue }
    const c = closureOf(v)
    if (!c) { problems++; say('  🔴 ' + label + '：vendor 里没有 node_modules'); continue }
    if (ref === null) ref = c.n
    const okc = c.missing.length === 0
    if (!okc) problems++
    say('  ' + (okc ? '✅' : '🔴') + ' ' + label + '：' + c.n + ' 个包' + (okc ? '，闭包完整' : '，缺 ' + c.missing.length + ' 个 → ' + c.missing.slice(0, 6).join(', ')))
  }
  if (ref !== null) say('     （判据：vendor 内每个包声明的 dependencies 都得在 vendor 里找到；缺件 = 运行时会炸，但自检全绿）')
} catch (e) { say('  （vendor 闭包检查失败：' + String(e && e.message).slice(0, 90) + '）') }

// K 段（2026-10-16 新增）：全局经验库体检。
// 为什么需要：经验库是**今天新加的第 2 个库**，位置在 ~/.sessionrelay/global.sqlite ——
// 跟项目库完全分开。新组件最容易被当盲区：库不存在、打不开、或**只剩 0 条**（被误删/误清）时，
// 简报只是"没有经验段"，看起来一切正常 —— 正是本项目最嫌恶的静默半失效。
// 判据：库在不在、能不能读、有多少条、多少条够注入线。
say('')
say('══════ K. 全局经验库（跨项目，独立于各项目库）══════')
try {
  const HOME4 = process.env.USERPROFILE || process.env.HOME
  const gpath = process.env.SRELAY_GLOBAL_HOME
    ? path.join(process.env.SRELAY_GLOBAL_HOME, 'global.sqlite')
    : path.join(HOME4, '.sessionrelay', 'global.sqlite')
  if (!fs.existsSync(gpath)) {
    say('  ⚪ 还没有经验库（没记过经验）——' + gpath)
  } else if (!_DatabaseSync) {
    say('  ⚪ 当前 Node 无 node:sqlite，跳过读取')
  } else {
    const g = new _DatabaseSync(gpath, { readOnly: true })
    try {
      const total = Number(g.prepare('SELECT count(*) c FROM lessons').get().c)
      const inj = Number(g.prepare("SELECT count(*) c FROM lessons WHERE status IN ('verified','confirmed') AND grade <> 'inferred'").get().c)
      const draft = Number(g.prepare("SELECT count(*) c FROM lessons WHERE status = 'draft'").get().c)
      const scopes = g.prepare('SELECT scope, count(*) c FROM lessons GROUP BY scope').all()
      say('  ✅ ' + gpath + '：共 ' + total + ' 条（可注入 ' + inj + ' · 草稿 ' + draft + '）')
      say('     作用域：' + scopes.map((r) => r.scope + '=' + r.c).join(' · '))
      if (total === 0) say('  ⚠️  库在但一条都没有（被清过？）')
    } finally { try { g.close() } catch {} }
  }
} catch (e) { say('  ⚠️  经验库读取失败：' + String(e && e.message).slice(0, 80)) }

// L 段（2026-10-16 收口新增）：适配器**能不能拿到核心引擎**。
// 为什么需要：红队 B 7.2 实测 —— 仓库副本的 ZCode hook 因为少了两个 import，
// 加载引擎那一段整块抛错、被 catch 吞掉，于是**静默退回旧排序**：输出照常有、日志一片干净，
// 只有"拿一道能区分两条路的题去问"才发现。这类失效人盯不住，让守门每次替我们问一遍。
// 判据（全为真才算过）：
//   ① 仓库 hook 与部署 hook 逐字节一致（曾分叉过：部署 18:49 / 仓库 19:08）；
//   ② 真跑一次 hook（默认环境、不设任何 SRELAY_*），它必须找到 recall.js（DEBUG 行里 engine=…）；
//   ③ 插件 vendor 的 recall.js 能被真实 import，且带上闸 2 与工作区解析这几个导出。
say('')
say('══════ L. 适配器能否拿到核心引擎（防静默降级）══════')
try {
  const zcodeDir = path.join(HOME, '.zcode/hooks/statebrief')
  // engine.mjs 必须一起查：它是引擎解析的唯一入口，缺在部署副本里 = hook 静默降级（本条正是为防这个）
  const AD_FILES = ['brief.mjs', 'brief-shared.mjs', 'brief-filters.mjs', 'brief-turn.mjs', 'engine.mjs']
  if (!fs.existsSync(zcodeDir)) {
    say('  ⚪ 没装 ZCode 适配器（跳过）')
  } else {
    for (const f of AD_FILES) {
      const a = md5File(path.join(ROOT, 'integrations/zcode', f))
      const b = md5File(path.join(zcodeDir, f))
      if (a && b && a === b) say('  ✅ ' + f + '：仓库 ⇄ 部署 一致')
      else { problems++; say('  🔴 ' + f + '：仓库与部署不一致 → node integrations/zcode/install.mjs --apply') }
    }
    const rr = spawnSync(process.execPath, [path.join(zcodeDir, 'brief-turn.mjs')], {
      input: JSON.stringify({ prompt: '闸2 相关性怎么算', cwd: ROOT }),
      encoding: 'utf8',
      env: { ...process.env, SRELAY_HOOK_DEBUG: '1' },
    })
    const dbg = String(rr.stderr || '')
    const mm = /engine= (.*)$/m.exec(dbg)
    const enginePath = mm ? mm[1].trim() : ''
    if (enginePath && enginePath !== '(无)' && fs.existsSync(enginePath)) {
      say('  ✅ hook 真跑：引擎来自 ' + enginePath)
    } else {
      problems++
      say('  🔴 hook 真跑没拿到引擎 ⇒ 每轮召回整段不出现（宁可少给，但必须让人看见）')
    }
  }
  const pv = path.join(ROOT, 'plugins/dsh/vendor/dist/recall.js')
  if (!fs.existsSync(pv)) { problems++; say('  🔴 插件 vendor 里没有 dist/recall.js') }
  else {
    const mod = await import(pathToFileURL(pv).href)
    const need = ['pickForInjection', 'gate2Score', 'resolveWorkspaceId', 'resolveDomain']
    const miss = need.filter((k) => typeof mod[k] !== 'function')
    if (miss.length) { problems++; say('  🔴 插件 vendor 的 recall.js 缺导出：' + miss.join(' / ')) }
    else say('  ✅ 插件 vendor recall.js 导出齐全（' + need.join(' / ') + '）')
  }
} catch (e) { problems++; say('  🔴 L 段异常：' + String(e && e.message).slice(0, 120)) }

say('')
if (problems === 0) say('✅ 全部一致，无需处理')
else say(`🔴 发现 ${problems} 处问题，按上面提示修`)
process.exit(problems === 0 ? 0 : 1)
