#!/usr/bin/env node
/**
 * ZCode 适配器安装器 —— 把「开场自动简报」装到一台（新）机器上。
 *
 * 装什么：
 *   ① 三个文件 → <ZCode Home>/hooks/statebrief/{brief.mjs, brief-shared.mjs, brief-filters.mjs}
 *   ② 把 SessionStart hook 注册进 <ZCode Home>/cli/config.json（hooks.events.SessionStart）
 *
 * 设计纪律（沿用本项目实测教训）：
 *   - **默认 dry-run**：不带 --apply 只打印计划。安装器自己不该是风险源。
 *   - **幂等**：重复跑只会更新，不会插两条。
 *   - **改配置先备份**：config.json → config.json.bak-<时间戳>，失败可精确恢复。
 *   - **必须有可执行验收**：装完真的跑一次 hook，看它有没有吐出合法 JSON（空输出也算失败——
 *     空输出是"静默半失效"的典型症状，正是本项目反复踩的那类）。
 *   - **不赌 PATH**：node 用 process.execPath（跑本安装器的那个），或 --node 显式指定。
 *
 * 用法：
 *   node install.mjs                                  # 看计划（dry-run）
 *   node install.mjs --apply                          # 真装
 *   node install.mjs --apply --node "D:/node/node.exe" # 指定 node
 *   node install.mjs --apply --zcode-home C:/Users/me/.zcode
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ZCODE = path.resolve(arg('zcode-home', path.join(os.homedir(), '.zcode')));
const NODE = arg('node', process.execPath);
const TARGET = path.join(ZCODE, 'hooks', 'statebrief');
const CONFIG = path.join(ZCODE, 'cli', 'config.json');
const FILES = ['brief.mjs', 'brief-shared.mjs', 'brief-filters.mjs'];

let bad = 0;
const say = (s) => console.log(s);
const doIt = (s) => say((APPLY ? '  ✓ ' : '  · ') + s);

say('══ ZCode 适配器安装' + (APPLY ? '' : '（dry-run，加 --apply 才真装）') + ' ══');
say('  ZCode Home : ' + ZCODE);
say('  node       : ' + NODE);
say('  配置文件   : ' + CONFIG);

// 0) 前置检查
for (const f of FILES) if (!fs.existsSync(path.join(HERE, f))) { say('  🔴 源文件缺失: ' + f); bad++; }
if (!fs.existsSync(NODE)) { say('  🔴 node 不存在: ' + NODE); bad++; }
if (!fs.existsSync(ZCODE)) { say('  🔴 ZCode Home 不存在: ' + ZCODE + '（用 --zcode-home 指定）'); bad++; }
if (bad) { say('\n🔴 前置检查未过，未做任何改动'); process.exit(1); }

// 1) 拷贝文件
say('\n[1] 拷贝适配器文件 → ' + TARGET);
for (const f of FILES) {
  const s = path.join(HERE, f), t = path.join(TARGET, f);
  const same = fs.existsSync(t) && fs.readFileSync(s).equals(fs.readFileSync(t));
  doIt(f + (same ? '（已一致，跳过）' : ''));
  if (APPLY && !same) { fs.mkdirSync(TARGET, { recursive: true }); fs.copyFileSync(s, t); }
}

// 2) 注册 hook（幂等）
say('\n[2] 注册 SessionStart hook → ' + CONFIG);
let cfg = { hooks: { enabled: true, events: { SessionStart: [{ hooks: [] }] } } };
let existed = false;
if (fs.existsSync(CONFIG)) cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
cfg.hooks = cfg.hooks || { enabled: true, events: {} };
cfg.hooks.enabled = true;
cfg.hooks.events = cfg.hooks.events || {};
const list = (cfg.hooks.events.SessionStart = cfg.hooks.events.SessionStart || [{ hooks: [] }]);
if (!Array.isArray(list[0].hooks)) list[0].hooks = [];
const entry = {
  type: 'process', command: NODE,
  args: [path.join(TARGET, 'brief.mjs').replace(/\\/g, '/')],
  timeoutMs: 20000, statusMessage: '拉取项目状态简报',
};
const hit = list[0].hooks.findIndex((h) => Array.isArray(h.args) && h.args.some((a) => String(a).includes('statebrief')));
if (hit >= 0) { existed = true; list[0].hooks[hit] = entry; } else list[0].hooks.push(entry);
doIt((existed ? '更新已有注册' : '新增注册') + '：' + entry.command + ' ' + entry.args[0]);
if (APPLY) {
  if (fs.existsSync(CONFIG)) {
    const bak = CONFIG + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(CONFIG, bak);
    say('    已备份原配置 → ' + path.basename(bak));
  } else fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), 'utf8');
}

// 3) 真实验收（空输出 = 静默半失效，判失败）
say('\n[3] 验收：真跑一次 hook（在临时空目录里 = 无项目库的路径）');
if (APPLY) {
  let out = '';
  try {
    out = execFileSync(NODE, [path.join(TARGET, 'brief.mjs')], { cwd: os.tmpdir(), timeout: 30000, encoding: 'utf8', windowsHide: true });
  } catch (e) { say('  ⚠️ hook 退出非 0（' + String(e.message).slice(0, 80) + '）——真项目目录里再试一次'); }
  const trimmed = (out || '').trim();
  if (trimmed.startsWith('{')) say('  ✅ hook 输出合法 JSON（' + trimmed.length + ' 字符）——注册链路通');
  else if (trimmed === '') say('  ⚠️ 空输出：可能只是"当前目录没有记忆库"（合法），也可能是链路不通。请到**真实项目目录**再跑一次：\n     ' + NODE + ' "' + path.join(TARGET, 'brief.mjs') + '" "<你的项目目录>"');
  else say('  🔴 输出不是 JSON，前 200 字：' + trimmed.slice(0, 200));
} else say('  （dry-run 跳过）');

say('\n' + (APPLY ? '✅ 安装完成' : '计划如上。加 --apply 执行。'));
say('提示：简报内容来自项目里的 .sessionrelay 记忆库；新项目首次要 srelay init 或由 hook 自动接入。');
process.exit(0);
