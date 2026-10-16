#!/usr/bin/env node
/**
 * _mirror_skills.mjs —— 技能入仓与副本镜像（2026-10-15 建，2026-10-16 改为"仓库为权威源"）
 *
 * 为什么需要它：
 *  ① 技能**同内容存在多处**（仓库 integrations/skills + ZCode/agents 侧 ~/.agents/skills + DSH 侧 ~/.dsh/skills），
 *     两边曾经各自漂移过（实测 handoff 技能两份 md5 不同、日期差两周）。技能是"接手者唯一入口"的元工具，
 *     它自己漂了，后面每一次交接都跟着漂 —— 所以纳入本框架守门，与插件副本同等待遇。
 *  ② 技能原先**不在任何仓库里**（只在用户目录），换机器/打离线包都会丢；本工具把仓库设为权威源。
 *
 * 权威源：<repo>/integrations/skills/<name>   →   镜像到 ~/.agents/skills/<name> 与 ~/.dsh/skills/<name>
 *
 * 用法：
 *   node tools/_mirror_skills.mjs            # 镜像 + 报告
 *   node tools/_mirror_skills.mjs --check    # 只检查不改（退出码 1 = 有差异）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC_ROOT = path.join(ROOT, 'integrations', 'skills');
const DST_ROOTS = [
  path.join(os.homedir(), '.agents', 'skills'),
  path.join(os.homedir(), '.dsh', 'skills'),
];
/** 需要镜像的技能（新增技能时加一行） */
const SKILLS = ['handoff-atlas'];
/** 已退役/已合并的技能——各技能目录里都必须不存在，否则会被当独立技能加载 */
const RETIRED = ['handoff', 'project-atlas'];

const CHECK = process.argv.includes('--check');
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
const listRel = (dir, base = dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') listRel(p, base, out); }
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
};

let problems = 0;
for (const name of SKILLS) {
  const s = path.join(SRC_ROOT, name);
  if (!fs.existsSync(path.join(s, 'SKILL.md'))) { console.log('🔴 权威源缺 SKILL.md: ' + s); problems++; continue; }
  const srcFiles = listRel(s).sort();
  for (const dstRoot of DST_ROOTS) {
    const d = path.join(dstRoot, name);
    const copy = [], del = [], diff = [];
    if (fs.existsSync(path.join(d, 'SKILL.md'))) {
      for (const f of srcFiles) {
        const sp = path.join(s, f), dp = path.join(d, f);
        if (!fs.existsSync(dp) || md5(sp) !== md5(dp)) { copy.push(f); if (fs.existsSync(dp)) diff.push(f); }
      }
      for (const f of listRel(d).sort()) if (!srcFiles.includes(f)) del.push(f);
    } else copy.push(...srcFiles);
    const need = !fs.existsSync(path.join(d, 'SKILL.md')) || copy.length || del.length;
    if (need && !CHECK) {
      for (const f of srcFiles) {
        const dp = path.join(d, f);
        fs.mkdirSync(path.dirname(dp), { recursive: true });
        fs.copyFileSync(path.join(s, f), dp);
      }
      for (const f of del) fs.rmSync(path.join(d, f));
    }
    if (need) {
      if (CHECK) problems++;
      console.log((CHECK ? '🔴 ' : '✅ 已同步 ') + name + ' → ' + dstRoot.replace(os.homedir(), '~')
        + ' 复制 ' + copy.length + (diff.length ? '（内容不同 ' + diff.length + '）' : '') + ' / 删陈旧 ' + del.length);
    } else console.log('✅ ' + name + ' ⇄ ' + dstRoot.replace(os.homedir(), '~') + ' 一致（' + srcFiles.length + ' 个文件）');
  }
}
for (const name of RETIRED) {
  const hit = DST_ROOTS.map((r) => path.join(r, name)).filter((p) => fs.existsSync(path.join(p, 'SKILL.md')));
  if (hit.length) { console.log('🔴 已退役技能仍在技能目录（会被当独立技能加载）: ' + hit.join(' , ')); problems++; }
  else console.log('✅ ' + name + ' 已退役（技能目录里没有）');
}
console.log(problems === 0 ? '\n技能：仓库为源，两处副本全部一致' : '\n技能副本有 ' + problems + ' 处问题');
process.exit(problems === 0 ? 0 : 1);
