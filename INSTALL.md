# 安装指南

> 三条路，按你的情况选一条：**A 从源码装**（有网络、有 node）、**B 用离线包**（无网络 / 新机器）、**C 只装某一端**。
> 每一步都有**可执行的验收**——本项目不接受"应该没问题"。

## 0. 先确认你要装什么

| 你在用什么 | 要装 | 装到哪 |
|---|---|---|
| ZCode | **内核** + **ZCode 适配器** | 全局 npm + `~/.zcode/` |
| DeepSeek Harness (DSH) | **内核** + **DSH 插件** | 全局 npm + `~/.dsh/profiles/<profile>/local-plugins/` |
| 两个都用 | 内核装一次，两个适配器都装 | 同上 |

**内核（packages/core）= 记忆本身**，所有端共用一份，装一次就够。
**适配器（dsh-plugin / zcode-adapter）= 只负责"把记忆摆到端面前"**。

**环境要求**：Node.js **>= 22.19**（或 >= 24）；Windows / macOS / Linux 均可。
核心库自带的原生模块（better-sqlite3 / jieba）在离线包里已含四平台预编译二进制。

---

## A. 从源码装（推荐给开发者）

```bash
git clone <本仓库> && cd sessionrelay-eco

# ① 内核
cd packages/core
npm install
npm run build          # 产出 dist/
npm i -g .             # 全局安装 → 得到 srelay 命令

# ② 给项目建库（在你要记忆的那个项目根目录里执行）
cd /path/to/your-project
srelay init            # 建 <项目>/.sessionrelay/relay.sqlite

# ③ 体检
srelay doctor          # 应报 N 项 0 失败
```

**为什么必须 `npm i -g .` 而不是 `npx`**：适配器（hook / 插件）是**在你不会盯着的地方**跑的后台进程，
它们要能稳定解析到 CLI。全局安装是唯一可靠的锚点。

### 装 ZCode 适配器

```bash
cd packages/zcode-adapter
node install.mjs                    # 先看计划（dry-run，默认不写任何东西）
node install.mjs --apply            # 真装：拷 3 个文件 + 注册 SessionStart hook
```

装完自检（在一个**真实项目目录**里跑）：

```bash
node "<你的 ZCode Home>/hooks/statebrief/brief.mjs" "/path/to/your-project"
# 期望：一行 JSON，里面 additionalContext 有看板/决策/文件行
```

- 想换 node 位置：`--node "D:/node/node.exe"`
- 想换 ZCode 目录：`--zcode-home "C:/Users/me/.zcode"`
- 卸载：把 `~/.zcode/hooks/statebrief/` 删掉，并在 `~/.zcode/cli/config.json` 里移除带 `statebrief` 的那条 hook
  （安装时会在同目录留 `config.json.bak-<时间戳>`，可直接恢复）

### 装 DSH 插件

```bash
# 插件是"on-disk plugin"：整个目录丢进 profile 的 local-plugins/ 即可
cp -r packages/dsh-plugin "<DSH Home>/profiles/<profile>/local-plugins/dsh-srelay-brief"
# 然后重启 DSH
```

⚠️ **插件需要 vendor/**（自包含运行时，约 61MB）。源码仓库里**不含**它（体积原因），
两种拿法：**①** 用 Release 里的离线包（已含 vendor，推荐）；**②** 在插件目录跑 `node vendor-srelay.mjs` 自行生成（需要 npm + 网络）。

**装完必须验**：

```bash
node "<插件目录>/selftest.mjs"      # 自测（真实链路断言）
```

然后**重启 DSH**，新开一个会话，看开场是否出现 📋 看板 / 决策行。
（常驻进程不会因为文件更新而更新——**改完不重启 = 你看到的还是旧版**。）

---

## B. 离线包（新机器 / 无网络）

Release 页下载 `ses-offline-<日期>-<时间>.zip`，解包后按其中的 `README` 执行。
包内已含：CLI 构建产物（`core-dist/`）、DSH 插件**连 vendor**、安装器、工具脚本。
**不需要 npm install、不需要联网、不需要本机预装 SessionRelay。**

校验完整性（Release 里同时给出 sha256）：

```bash
# Windows
certutil -hashfile ses-offline-*.zip SHA256
# macOS / Linux
shasum -a 256 ses-offline-*.zip
```

---

## C. 验收清单（装完逐条打勾）

| # | 检查 | 命令 / 看什么 |
|---|---|---|
| 1 | CLI 可用 | `srelay --version` |
| 2 | 目标项目有库 | 项目根出现 `.sessionrelay/` |
| 3 | 体检通过 | `srelay doctor` → 0 失败 |
| 4 | 采集源含你用的端 | `srelay status` → `sources` 里有 `zcode` / `dsh` |
| 5 | 简报真的有数 | `srelay brief` → 看板/决策/文件行非空 |
| 6 | 端侧真的注入 | ZCode：新开会话看开场；DSH：新会话看 📋 行 |
| 7 | 多副本一致（开发者） | `node tools/check-versions.mjs` → 全绿 |

**第 6 条最重要**：前五条全绿而第 6 条空，就是本项目最嫌恶的**静默半失效**——
装好了、体检绿、却什么都没注入。

---

## D. 常见问题

| 症状 | 多半是 | 怎么办 |
|---|---|---|
| 装完什么都不显示 | 适配器跑了，但**没有库** | 去项目根 `srelay init` |
| 简报是旧内容 | **常驻进程没重启** | 重启 DSH / 重开 ZCode 会话 |
| DSH 里插件没生效 | 插件目录放错 profile | 确认 `local-plugins/` 在**你正在用的** profile 下 |
| 插件加载失败但日志无报错 | 缺 vendor 或文件没进加载路径 | 用离线包；开发者跑 `check-versions.mjs` |
| 中文搜不到 | 分词器不一致 | `srelay doctor` 看分词器；索引与查询必须同一套 |
| 想彻底删掉记忆 | —— | 删除 `<项目>/.sessionrelay/` 整个目录 |

更多在 [docs/FAQ.md](docs/FAQ.md) 与 [docs/ENGINEERING-NOTES.md](docs/ENGINEERING-NOTES.md)。
