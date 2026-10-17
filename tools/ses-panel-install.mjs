#!/usr/bin/env node
// ses-panel-install.mjs —— 把「记忆台」面板装进 DSH profile（幂等 · 默认 dry-run）
//
// ═══ 为什么需要它（这不是"歪挂脚本"，是根治那个 404）═══
// 上一次的装法是**手工**的：把插件目录 cp 到 local-plugins/、手改 profile 的 package.json，
// 但**漏了 pnpm install** —— 于是 node_modules 里没有这个包，DSH 根本解析不到它，
// 症状是 /srelay-panel/api 永久 404（看起来像"路由没注册"，其实是"插件没装"）。
// 这个工具把那三步合成一条命令，并**在最后实测解析是否成功**，不会再让漏步静默。
//
// 装了什么：
//   ① 源码 → ~/.dsh/profiles/<p>/local-plugins/dsh-srelay-panel（逐文件 md5 比对）
//   ② 内核 dist → 该目录的 vendor/dist（面板宿主半 import 的唯一入口；只 583KB，无需 node_modules）
//   ③ profile 的 package.json：dependencies + dsh.profile.bundles 各加一行（并清掉旧的 dsh-panel 残留）
//   ④ pnpm install（真正把包链进 node_modules —— 上次就漏在这一步）
//   ⑤ 验证 node_modules 解析 + .pnpm 实体存在，并打印"要重启什么"
//
// 用法：
//   node tools/ses-panel-install.mjs                 # 只说会做什么（dry-run）
//   node tools/ses-panel-install.mjs --apply         # 真装（web profile）
//   node tools/ses-panel-install.mjs --apply --profiles web,desktop
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'integrations', 'dsh-srelay-panel');
const CORE_DIST = path.join(ROOT, 'core', 'SessionRelay', 'dist');
const HOME = process.env.USERPROFILE || os.homedir();
const DSH = path.join(HOME, '.dsh');
const PKG = 'dsh-srelay-panel';
const LEGACY = 'dsh-panel';
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] ?? dflt) : dflt; };
// ⚠️ 默认必须含 desktop —— 这是 1017 实测的教训：
//   DSH 桌面版主进程的 user-data-dir 是 `@deepseek-ai/dsh-desktop`，它加载的是 **desktop** profile
//   （决定性证据：所有引用 `.dsh/profiles/<X>` 的进程全是 desktop，零个 web）。
//   而这里第一版默认只装 `web` ⇒ 面板装到一个**根本不会被加载**的 profile 里，
//   症状就是「重启了 DSH 但左栏始终没有按钮」，而 boot 日志一片空白（因为宿主半压根没被 import）。
// web 也留着：命令行 `dsh web` 那条路仍然用它。
const PROFILES = String(arg('profiles', 'web,desktop')).split(',').map((s) => s.trim()).filter(Boolean);
const SKIP = new Set(['vendor', 'node_modules', '.git']);
const md5 = (p) => { try { return createHash('md5').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out); else out.push(r);
  }
  return out;
}

function copyTree(srcDir, dstDir, exts) {
  let copied = 0, missing = 0, same = 0;
  for (const rel of walk(srcDir, '', [])) {
    if (exts && !exts.some((x) => rel.endsWith(x))) continue;
    const s = path.join(srcDir, rel), d = path.join(dstDir, rel);
    if (md5(s) === md5(d)) { same++; continue; }
    if (!fs.existsSync(d)) missing++;
    if (APPLY) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
    copied++;
  }
  return { copied, missing, same };
}

/** 内核 dist → vendor/dist：先删"副本有、权威源没有"的文件（铁律 20 的精简版） */
function syncVendorDist(dstVendor) {
  const dst = path.join(dstVendor, 'dist');
  const want = new Set(fs.readdirSync(CORE_DIST));
  let removed = 0;
  if (fs.existsSync(dst)) {
    for (const f of fs.readdirSync(dst)) if (!want.has(f)) { removed++; if (APPLY) fs.rmSync(path.join(dst, f), { force: true, recursive: true }); }
  }
  const r = copyTree(CORE_DIST, dst, ['.js']);
  const pj = path.join(dstVendor, 'package.json');
  const pjText = JSON.stringify({ name: '@ewanjasper/sessionrelay', version: '0.5.1-fork.1', type: 'module' }, null, 2) + '\n';
  let pjChanged = false;
  try { pjChanged = fs.readFileSync(pj, 'utf8') !== pjText; } catch { pjChanged = true; }
  if (APPLY && pjChanged) { fs.mkdirSync(dstVendor, { recursive: true }); fs.writeFileSync(pj, pjText, 'utf8'); }
  return { ...r, removed, pjChanged };
}

function patchProfile(profileDir) {
  const pj = path.join(profileDir, 'package.json');
  if (!fs.existsSync(pj)) return { ok: false, why: '没有 package.json' };
  const raw = fs.readFileSync(pj, 'utf8');
  const obj = JSON.parse(raw);
  const changes = [];
  obj.dependencies = obj.dependencies || {};
  if (obj.dependencies[LEGACY]) { delete obj.dependencies[LEGACY]; changes.push('删掉残留依赖 ' + LEGACY); }
  const want = 'file:./local-plugins/' + PKG;
  if (obj.dependencies[PKG] !== want) { obj.dependencies[PKG] = want; changes.push('dependencies += ' + PKG); }
  obj.dsh = obj.dsh || {}; obj.dsh.profile = obj.dsh.profile || {};
  const bundles = obj.dsh.profile.bundles || (obj.dsh.profile.bundles = []);
  const kept = bundles.filter((b) => b !== LEGACY);
  if (kept.length !== bundles.length) changes.push('bundles 去掉 ' + LEGACY);
  obj.dsh.profile.bundles = kept;
  if (!kept.includes(PKG)) { kept.push(PKG); changes.push('bundles += ' + PKG); }
  if (!changes.length) return { ok: true, changes, wrote: false };
  if (APPLY) {
    fs.copyFileSync(pj, pj + '.bak-panel-' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    fs.writeFileSync(pj, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  }
  return { ok: true, changes, wrote: APPLY };
}

/**
 * 用**DSH 自己带的那个 pnpm** 装（不是 PATH 上的）。
 *
 * 为什么必须这样（本工具第一版就栽在这）：
 *   实测 profile 的 node_modules/.modules.yaml 写着 packageManager: pnpm@11.7.0、storeDir: ...\\store\\v11；
 *   而 PATH 上的 pnpm 是 10.34.5（store v10）。**大版本不同** ⇒ pnpm 10 判定"现有 node_modules 不兼容"，
 *   要求清空重装；非 TTY 下它直接中止：ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY。
 *   一句话：用错 pnpm 会拿"清空整个 node_modules"当默认动作 —— 这不是能靠 --force 绕的事。
 *   DSH 的插件管理器本身就是这么调的（证据：profile/.plugin-manager/logs/operation-XXXX/pnpm.log）：
 *     "<Harness>.exe" --expose-internals "<resources>/runtime/pnpm/bin/pnpm.mjs" add <spec>
 * 找不到就**明说**并给出覆盖方式，不退回 PATH 上的 pnpm（那会做出上面那件危险的事）。
 */
function pnpmTool() {
  const env = process.env.DSH_PNPM;
  if (env) {
    const [exe, script] = env.split('|');
    if (exe && script && fs.existsSync(exe) && fs.existsSync(script)) return { exe, script, how: 'env DSH_PNPM' };
  }
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness'),
    'C:/Users/crx/AppData/Local/Programs/DeepSeek Harness',
  ];
  for (const r of roots) {
    const exe = path.join(r, 'DeepSeek Harness.exe');
    const script = path.join(r, 'resources', 'runtime', 'pnpm', 'bin', 'pnpm.mjs');
    if (fs.existsSync(exe) && fs.existsSync(script)) return { exe, script, how: 'DSH 自带运行时' };
  }
  return null;
}

function pnpmInstall(profileDir) {
  const tool = pnpmTool();
  if (!tool) return { ok: false, out: '', err: '找不到 DSH 自带的 pnpm（设 DSH_PNPM="<exe>|<pnpm.mjs>" 覆盖）。刻意不退回 PATH 上的 pnpm：版本不同会要求清空整个 node_modules。' };
  try {
    const out = execFileSync(tool.exe, ['--expose-internals', tool.script, 'install', '--prefer-offline'], {
      cwd: profileDir, encoding: 'utf8', timeout: 900000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: String(out).slice(-2500), how: tool.how };
  } catch (e) {
    return {
      ok: false, how: tool.how,
      out: String((e && e.stdout) || '').slice(-2500),
      err: String((e && e.stderr) || (e && e.message) || e).slice(-2500),
    };
  }
}

function verify(profileDir) {
  const link = path.join(profileDir, 'node_modules', PKG);
  const pnpm = path.join(profileDir, 'node_modules', '.pnpm');
  let real = null;
  try { real = fs.realpathSync(link); } catch { real = null; }
  const pnpmHit = fs.existsSync(pnpm) ? fs.readdirSync(pnpm).find((d) => d.startsWith(PKG + '@')) : null;
  return { linked: !!real, link, real, pnpmEntry: pnpmHit || null };
}


/**
 * 已部署的 .pnpm 副本与源码**逐字节比对**（只比 lib/ 下的 js 与 package.json）。
 *
 * 为什么必须有这一步（1018 真事故）：「链接已就绪 且 清单没变 ⇒ 跳过安装」这个判据只回答了
 * 「装过没有」，没回答「装的是不是当前这份」。于是改了 lib/client.js 之后：
 *   链接在、清单没变 → 整步被跳过 → .pnpm 里那份还是旧的 →
 *   DSH 重启后加载的仍是旧代码，而安装脚本打印的是「✅ 装好了」。
 * 实测：源码 44625386…，已部署 951c12e4…，两个 session 都没生效。
 * 这是本仓反复出现的「判据没有覆盖被判断的对象」的第 7 次。
 */
function deployedDrift(profileDir) {
  const link = path.join(profileDir, 'node_modules', PKG);
  let real = null;
  try { real = fs.realpathSync(link); } catch { return { ok: true, drift: [], why: '无链接（无需比内容）' }; }
  const drift = [];
  const cmp = (rel) => {
    const a = path.join(SRC, rel), b = path.join(real, rel);
    try {
      if (!fs.existsSync(b)) { drift.push(rel + '(缺)'); return; }
      const ha = createHash('md5').update(fs.readFileSync(a)).digest('hex');
      const hb = createHash('md5').update(fs.readFileSync(b)).digest('hex');
      if (ha !== hb) drift.push(rel);
    } catch { drift.push(rel + '(读不到)'); }
  };
  cmp('package.json');
  for (const f of fs.readdirSync(path.join(SRC, 'lib'))) if (f.endsWith('.js')) cmp(path.join('lib', f));
  return { ok: drift.length === 0, drift, real };
}
/**
 * 兜底：pnpm 装不动时，**手工铺出与 pnpm 等价的布局**。
 *
 * 为什么需要它（1017 实测，可复现两次）：
 *   profile 里早就有一个 `file:` 依赖（兄弟插件 dsh-srelay-brief），而 **DSH 正在跑**。
 *   pnpm 是**整树 install**：它会把所有 file: 依赖重新 import 一遍，做法是
 *   「先解到 `<名字>_tmp_<pid>_<n>`，再 rename 成正式目录」——
 *   而 rename 的目标目录正被运行中的宿主占着 ⇒
 *     ERR_PNPM_EPERM ... rename '...dsh-srelay-brief_tmp_71288_22' -> '...dsh-srelay-brief'
 *   于是一步失败、**一个链接都不会建**，`node_modules/dsh-srelay-panel` 永远不出现。
 *   ⚠️ 这一步与面板本身毫无关系（面板**零依赖**），纯粹是被兄弟插件连坐。
 *
 * 为什么手工铺是**安全**的：面板包不声明任何外部依赖时，pnpm 会产出的布局是确定性的 ——
 *   .pnpm/<PKG>@file+local-plugins+<PKG>/node_modules/<PKG>   ← 内容 = 源码副本
 *   node_modules/<PKG>                                        ← 指向上面那目录
 * （web profile 实测就是这个形状，两处 md5 逐字节相同）。
 * **一旦面板声明了外部依赖，这里就拒绝兜底** —— 手工铺会漏装依赖，那比装不上更坏。
 */
function materialize(profileDir) {
  const pj = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...(pj.dependencies || {}), ...(pj.optionalDependencies || {}) });
  if (deps.length > 0) return { ok: false, why: '面板包声明了外部依赖（' + deps.join(', ') + '），手工铺会漏装 ⇒ 拒绝兜底' };
  const entry = path.join(profileDir, 'node_modules', '.pnpm', PKG + '@file+local-plugins+' + PKG, 'node_modules', PKG);
  try {
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    const c = copyTree(SRC, entry, null);
    const cv = syncVendorDist(path.join(entry, 'vendor'));
    const link = path.join(profileDir, 'node_modules', PKG);
    try { fs.unlinkSync(link); } catch { /* 本来就没有 */ }
    // Windows 上目录符号链接要管理员或开发者模式；junction 不需要，Node 的解析行为相同。
    fs.symlinkSync(entry, link, 'junction');
    return { ok: true, copied: c.copied, vendor: cv.copied, entry };
  } catch (e) { return { ok: false, why: String(e && e.message || e).slice(0, 200) }; }
}

// 作者副本也要有 vendor/dist —— 插件自测跑的**就是作者副本**（真实的加载路径），
// 没有 vendor 它就连不起来。生成物不进 git（见插件目录的 .gitignore）。
const authorVendor = syncVendorDist(path.join(SRC, 'vendor'));

console.log('记忆台面板安装' + (APPLY ? '（--apply 真写）' : '（dry-run，只看会做什么）'));
console.log('  源    ' + SRC);
console.log('  内核  ' + CORE_DIST + ' → vendor/dist');
console.log('  profile  ' + PROFILES.join(', '));
if (!fs.existsSync(CORE_DIST) || !fs.existsSync(path.join(CORE_DIST, 'panel.js'))) {
  console.log('\n🔴 内核 dist/panel.js 不存在 —— 先跑：cd core/SessionRelay && npm run build');
  process.exit(1);
}
let failures = 0;
for (const prof of PROFILES) {
  const profileDir = path.join(DSH, 'profiles', prof);
  console.log('\n── ' + prof + ' ──');
  if (!fs.existsSync(profileDir)) { console.log('  ⚪ profile 不存在，跳过'); continue; }
  const dst = path.join(profileDir, 'local-plugins', PKG);
  const a = copyTree(SRC, dst, null);
  console.log('  ① 源码：复制 ' + a.copied + '（新文件 ' + a.missing + '）· 已一致 ' + a.same);
  const v = syncVendorDist(path.join(dst, 'vendor'));
  console.log('  ② 内核：复制 ' + v.copied + '（新文件 ' + v.missing + '）· 清掉旧块 ' + v.removed + (v.pjChanged ? ' · 写 vendor/package.json' : ''));
  const p = patchProfile(profileDir);
  console.log('  ③ profile 清单：' + (p.changes.length ? p.changes.join(' · ') : '无需改动'));
  if (APPLY) {
    // ⚠️ [1017 夜 · 根治] **没有要装的东西时，绝不调 pnpm。**
    // 病历（真事故，可复现）：pnpm 是**整树 install**，它会把所有 `file:` 依赖重新 import 一遍 ——
    //   包括兄弟插件 dsh-srelay-brief。而那个目录正被**运行中的 DSH** 占着，rename 失败：
    //     ERR_PNPM_EPERM ... rename '...dsh-srelay-brief_tmp_...' -> '...dsh-srelay-brief'
    //   两头受伤：① 面板的链接建不出来；② brief 的 .pnpm 副本被还原成缓存里的**旧快照**
    //   （实测 vendor/dist 64 个文件全没了，而 check-versions 的 E 段正是抓这个的）。
    //   —— 也就是说：每跑一次构建管线，就把兄弟插件砸一次。修一次被砸一次。
    // 判据：链接已就绪 **且** profile 清单没变 ⇒ 没有要装的东西 ⇒ 跳过。
    const pre = verify(profileDir);
    // [1018 修「装了但没生效」] 跳过判据补第三条：**已部署内容必须与源码一致**。
    //   只判「链接在 + 清单没变」会漏掉最常发生的那件事 —— 改了 lib/ 里的代码。
    //   实测：改了 client.js 后链接一直在、清单没变 ⇒ 整步跳过 ⇒ .pnpm 里还是旧代码，
    //   而脚本打印「✅ 装好了」，用户重启两次都看不到变化。
    const drift0 = deployedDrift(profileDir);
    const needInstall = !pre.linked || p.changes.length > 0 || !drift0.ok;
    let skipNote = '';
    let pi = { ok: true, how: '跳过（无需安装）', out: '', err: '' };
    if (!needInstall) {
      skipNote = '链接已就绪 · profile 清单未变 · 内容与源码逐字节一致 —— 没有要装的东西';
    } else if (pre.linked && p.changes.length === 0 && !drift0.ok) {
      // 只有内容漂了：**手工铺**是最快的修法，而且完全不碰 pnpm（避免连坐兄弟插件）
      console.log('  ④ 内容漂移 ' + drift0.drift.length + ' 处（' + drift0.drift.slice(0, 3).join(', ') + (drift0.drift.length > 3 ? ' …' : '') + '）→ 强刷');
      const m = materialize(profileDir);
      if (m.ok) {
        console.log('     已逐字节重铺 .pnpm 副本（复制 ' + m.copied + ' · 内核 ' + m.vendor + '）—— 未调用 pnpm');
        skipNote = '内容已强刷';
      } else {
        console.log('     手工重铺失败：' + m.why + ' → 回退 pnpm install');
      }
    } else {
      console.log('  ④ pnpm install …');
      pi = pnpmInstall(profileDir);
    }
    let ver = verify(profileDir);
    let fellBack = false;
    // ④b：pnpm 失败且链接没建出来 → 手工铺等价布局（见 materialize 的注释：被运行中的宿主连坐）。
    // 判据是**能不能用**而不是 pnpm 报没报错：只有链接真的立起来了才算装好。
    if (!ver.linked) {
      const m = materialize(profileDir);
      if (m.ok) {
        console.log('  ④b pnpm 没建成链接 → 手工铺 .pnpm 布局（复制 ' + m.copied + ' · 内核 ' + m.vendor + '）');
        console.log('     为什么安全：面板零外部依赖，布局是确定性的（与 pnpm 在 web profile 产出的一致）');
        ver = verify(profileDir);
        fellBack = true;
      } else {
        console.log('  ④b 手工兜底不可用：' + m.why);
      }
    }
    // 结果分三态输出。**兜底成功时不许留 🔴** —— ses-rebuild 按 `!out.includes('🔴')` 判成败，
    // 留一个红字会让整条构建管线假红（假红比没有更糟：下一个人会直接删掉这条检查）。
    if (skipNote) {
      console.log('  ④ pnpm install ⏭️ 跳过（' + skipNote + '）');
      console.log('     为什么不无脑装：pnpm 会顺带重装兄弟插件，把它的 .pnpm 副本砸成旧快照');
    } else if (pi.ok) {
      console.log('  ④ pnpm install ✅ 装完（' + pi.how + '）');
    } else if (ver.linked) {
      // 措辞要分清「本次兜的」与「上次已兜好」—— 否则重跑时读日志的人会去找一个根本没跑的步骤。
      console.log('  ④ pnpm install ⚠️ 失败' + (fellBack ? '（本次已由 ④b 兜底，安装结果可用）' : '（链接此前已由兜底铺好，本次未重建）'));
      const first = String(pi.err || '').split(String.fromCharCode(10)).filter((l) => l.includes('ERR_PNPM'))[0];
      if (first) console.log('     ' + first.trim());
      else if (pi.err) console.log('     ' + String(pi.err).slice(0, 200));
    } else {
      console.log('  ④ pnpm install 🔴 失败（' + (pi.how || '?') + '）');
      if (pi.out) console.log('     stdout: ' + pi.out);
      if (pi.err) console.log('     stderr: ' + pi.err);
      failures++;
    }
    console.log('  ⑤ 解析验证：node_modules/' + PKG + ' → ' + (ver.linked ? '✅ ' + ver.real : '🔴 没有链接') + (ver.pnpmEntry ? ' · .pnpm/' + ver.pnpmEntry : ' · 🔴 .pnpm 里没有实体'));
    if (!ver.linked) failures++;
    // ⑥ .pnpm 实体也要补齐 —— pnpm 对 file: 依赖用缓存内容重建，**可能只是旧快照**
    //    （实测：兄弟插件 dsh-srelay-brief 的 .pnpm 副本被还原成缺 6 个文件的旧树，
    //     而 check-versions 的 E 段正是抓这个的）。DSH 真正加载的就是 .pnpm 那份。
    if (ver.real && fs.existsSync(ver.real) && fs.realpathSync(ver.real) !== fs.realpathSync(dst)) {
      const b = copyTree(SRC, ver.real, null);
      const bv = syncVendorDist(path.join(ver.real, 'vendor'));
      console.log('  ⑥ .pnpm 实体补齐：复制 ' + b.copied + ' + 内核 ' + bv.copied + (b.copied + bv.copied ? '（pnpm 缓存快照旧了）' : '（已一致）'));
    } else if (ver.real) {
      console.log('  ⑥ .pnpm 实体与 local-plugins 是同一个目录，无需补齐');
    }
  } else {
    console.log('  ④ pnpm install（dry-run 不跑）');
    console.log('  ⑤ 解析验证（dry-run 不跑）');
  }
}
console.log('\n作者副本 vendor/dist：' + (authorVendor.copied ? '同步 ' + authorVendor.copied + ' 个文件' : '已是最新') + '（自测要用）');
console.log(failures ? '🔴 ' + failures + ' 项没通过' : (APPLY ? '✅ 装好了' : '（dry-run 结束；加 --apply 真装）'));
console.log('⚠️ 常驻进程不会自己换新代码：客户端插件与宿主半边都要**重启 DSH**才生效。');
console.log('   重启后自检：curl http://127.0.0.1:19387/srelay/api/diagnostics');
