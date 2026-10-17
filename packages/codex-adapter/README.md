# Codex 接入 SessionRelay

让 Codex 拥有**跨会话记忆**：开场自动看见项目状态简报，需要时能主动检索/记录。

> 本适配器与 **ZCode 适配器共用同一份简报组装逻辑**（`../zcode/brief-shared.mjs`），
> 所以两端注入的内容逐字相同。改一处、两端同时生效。

---

## 三个能力，装法不同

| 能力 | 作用 | 装到哪 |
|---|---|---|
| **① 开场简报** | 每次新会话/恢复/压缩后，自动注入项目状态 | `~/.codex/hooks.json` |
| **② MCP 工具** | 让 Codex 能**主动**查历史、记决策（13 个工具） | `~/.codex/config.toml` |
| **③ 交接技能** | 教 Codex「什么时候该写交接件」 | `~/.codex/skills/handoff-atlas/` |

三者独立，可以只装其中一部分。

---

## 一键安装

```bash
# 在 SessionRelay 仓库根
node integrations/codex/install.mjs

# 只装简报，不碰 MCP
node integrations/codex/install.mjs --no-mcp

# 先看看会做什么（不写盘）
node integrations/codex/install.mjs --dry-run

# 全部撤销
node integrations/codex/install.mjs --uninstall
```

安装器**全部幂等**、**改前必备份**（`config.toml.bak-<时间戳>`）。

---

## ⚠️ 装完还差一步：必须手动 Trust

**这是 Codex 的安全设计，不是 bug。**

Codex 要求**非托管 hook 先经过人工审核并 trust 才会运行**。脚本无法代劳（代劳了也不该信）。

所以装完后你必须：

```
在 Codex 里输入  /hooks
  → 找到 SessionRelay 的 SessionStart 条目
  → 审核后选择 Trust
```

**不 trust 的症状**：装好了，但什么都没注入 —— 看着像坏了，其实只是还没批准。

> 这正是本框架最嫌恶的「装好了 ≠ 生效了」。
> 所以安装器最后**不会打印「全部完成」**，而是明确告诉你还差这一步。

---

## 装完了怎么验证

**① 简报**：新开一个 Codex 会话，开场应该能看到 `📍 项目状态简报`。

**② MCP**：让 Codex「用 srelay_stats 看看这个项目的记忆库」，它应该能调到。

**③ 排错**：带上调试开关手动跑一次钩子，看它到底说了什么：

```bash
# Windows PowerShell
$env:SRELAY_BRIEF_DEBUG='1'
'{"cwd":"D:/你的项目","hook_event_name":"SessionStart","source":"startup"}' | node ~/.codex/hooks/statebrief/brief.mjs
```

```bash
# macOS / Linux
SRELAY_BRIEF_DEBUG=1 \
  echo '{"cwd":"'"$PWD"'","hook_event_name":"SessionStart","source":"startup"}' \
  | node ~/.codex/hooks/statebrief/brief.mjs
```

- **有 JSON 输出** → 钩子本身好的，问题在 trust 那步
- **空输出 + stderr 有原因** → 按 stderr 修（多半是找不到 `srelay` CLI）

---

## 干什么用：三个真实场景

**场景一：新会话不用交代背景。**
你昨天让 Codex 改了 `db.ts`。今天新开会话，它开场就知道「这个项目在做什么、哪几件事还开着、上次踩了什么坑」——不用你重讲一遍。

**场景二：压缩之后不失忆。**
Codex 上下文压满会 compact，压缩会丢掉细节。本适配器在 `source: "compact"` 时**重新注入**简报。
（`matcher` 里那串 `startup|resume|clear|compact` 就是干这个的。）

**场景三：换个工具接着干。**
这个项目在 Codex 里聊的，换到 ZCode / DSH 里接着聊——因为记忆存在**项目目录**里（`.sessionrelay/`），不在某个工具的服务器上。

---

## 它不做什么

- **不消耗你的 token 来"记忆"**：采集发生在钩子和守护进程里，不占用对话上下文。
- **不改写你的记忆**：存的是原文，不做摘要。
- **不联网**：全本机 SQLite。
- **不上传任何东西**。

---

## 卸载

```bash
node integrations/codex/install.mjs --uninstall
```

会移除 `hooks.json` 条目、`config.toml` 的 `[mcp_servers.sessionrelay]`、以及两个安装目录。
**不动 `.sessionrelay/`**（那是你的数据，卸载工具不该删记忆）——要清自己 `rm -rf .sessionrelay`。

---

## 和 ZCode 适配器的关系

| | ZCode | Codex |
|---|---|---|
| 简报逻辑 | `integrations/zcode/brief-shared.mjs` | **同一份** |
| hook 配置 | `~/.zcode/cli/config.json` | `~/.codex/hooks.json` |
| 输出契约 | `hookSpecificOutput.additionalContext` | **同一个** |
| MCP 配置 | `config.json → mcp.servers` | `config.toml → [mcp_servers.X]` |
| 需要 trust 吗 | 否 | **是（Codex 特有）** |

唯一实质性差异就是 **Codex 多一道 trust 审核**，其余完全同构。
