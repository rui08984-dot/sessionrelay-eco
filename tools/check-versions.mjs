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
import { execSync } from 'node:child_process'
// G 段要直接读各项目库的概况：用内置 node:sqlite（Node ≥22.5）。取不到就把 G 段的统计降级。
let _DatabaseSync = null
try { ({ DatabaseSync: _DatabaseSync } = await import('node:sqlite')) } catch { /* 老 Node：G 段仍会打印看板与体积 */ }
import { pathToFileURL } from 'node:url'

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

const PLUGIN_FILES = ['index.js', 'project-resolve.mjs', 'selftest.mjs', 'src/brief-sql.mjs', 'src/tools.js', 'src/state.js', 'src/cli.js', 'src/define-tool.js']

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
say('══════ C. 守护进程是否在跑当前磁盘代码 ═══')
try {
  const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*srelay.js watch*\' } | ForEach-Object { $_.ProcessId.ToString() + \'|\' + $_.CreationDate.ToString(\'yyyy-MM-dd HH:mm:ss\') }"', { encoding: 'utf8' })
  const lines = out.trim().split('\n').filter(Boolean)
  if (!lines.length) { problems++; say('  🔴 没有守护进程在跑（采集停摆）') }
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
  const out2 = execSync('powershell -NoProfile -Command "Get-Process | Where-Object { $_.ProcessName -like \'*DeepSeek*\' } | ForEach-Object { $_.Id.ToString() + \'|\' + $_.StartTime.ToString(\'yyyy-MM-dd HH:mm:ss\') + \'|\' + $_.ProcessName }"', { encoding: 'utf8' })
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
    // 只报**最早**启动的那个：Electron 主进程先起、渲染/GPU 子进程紧随其后，
    // 逐个列出来会刷 10 行噪声（实测 10 个同名进程），而只需要知道"宿主是什么时候起的"。
    const hosts = []
    for (const l2 of hostLines) {
      const [pid2, started2, pname2] = l2.trim().split("|")
      const st2 = new Date(String(started2).replace(" ", "T")).getTime()
      if (Number.isFinite(st2)) hosts.push({ pid: pid2, start: st2, at: started2, name: pname2 })
    }
    if (hosts.length) {
      hosts.sort((a, b) => a.start - b.start)
      const h0 = hosts[0]
      const stale2 = Number.isFinite(newest) && newest > h0.start
      say(`  ${stale2 ? "⚠️ " : "✅"} DSH 宿主最早启动于 ${h0.at}（${h0.name} pid ${h0.pid}；同名进程 ${hosts.length} 个）`)
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
    let sess = 0, dec = 0, mb = 0, ver = 0, winN = 0, winSess = 0, winMax = 0, revivedN = 0, revivedDec = 0
    if (fs.existsSync(dbp) && _DatabaseSync) {
      mb = Math.round(fs.statSync(dbp).size / 1024 / 1024)
      try {
        const d = new _DatabaseSync(dbp, { readOnly: true, timeout: 5000 })
        sess = d.prepare('SELECT COUNT(*) AS n FROM sessions').get().n ?? 0
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
    say(`  ${flags.length ? '⚠️ ' : '✅'} ${root.padEnd(34)} ${kanban.padEnd(16)} ${String(sess).padStart(4)} 会话 ${String(dec).padStart(5)} 决策 ${String(mb).padStart(3)}MB v${ver} 窗内${String(winN).padStart(3)}条/${String(winSess).padStart(2)}场${flags.length ? '  ← ' + flags.join(' / ') : ''}`)
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
    } catch { say('  ⚪ ' + r2 + '：CLI 的 brief 命令不可用（老构建？）——跳过') ; continue }
    let fromPlug = null
    try { fromPlug = plug.queryRecentFiles(r2, { days: 7, top: 3 }) } catch (e) { say('  ⚪ ' + r2 + '：插件侧取数失败 ' + String(e && e.message).slice(0, 60)) ; continue }
    const same = JSON.stringify(fromCli) === JSON.stringify(fromPlug)
    if (!same) problems++
    say('  ' + (same ? '✅' : '🔴') + ' ' + r2 + ' → ' + JSON.stringify(fromCli) + (same ? '' : '\n       ≠ 插件 ' + JSON.stringify(fromPlug) + '\n       ← 两份实现已漂：DSH 与 ZCode 会显示不同的文件集合'))
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

say('')
if (problems === 0) say('✅ 全部一致，无需处理')
else say(`🔴 发现 ${problems} 处问题，按上面提示修`)
process.exit(problems === 0 ? 0 : 1)
