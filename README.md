# SessionRelay 生态 · AI 项目记忆层

> **让你的 AI 记住这个项目**：决策、未决问题、最近在动的东西，在你开口之前就摆到它面前。
> 本地优先 · 零神经网络 · 完全离线可用 · 一个项目一个库。

本项目是 [SessionRelay](https://github.com/EwanJasper/SessionRelay)（MIT）的深度改造，外加**两端集成**，
一个仓库装下全部内容。

---

## ⬇️ 先看你用哪个客户端，就下哪个

| 你在用什么 | 下载 | 干什么用的 | 大小 |
|---|---|---|---|
| **DeepSeek Harness (DSH)** | **dsh-plugin-0.2.0.zip** | 每轮自动把项目简报注入 system prompt | ~20MB（自带运行时） |
| **ZCode** | **zcode-adapter-1.0.0.zip** | 开场自动注入项目简报（SessionStart hook） | ~21KB |
| 两个都用 / 新机器一次装齐 | **ses-offline-\<日期\>.zip** | 全家桶：内核产物 + 插件 + 适配器 + 技能 + 工具 | ~20MB |

三个包都在 **[Releases](https://github.com/rui08984-dot/sessionrelay-eco/releases/latest)** 页。
**两个客户端都还需要内核**（记忆本体）——从源码装一次即可，见下面「三分钟装上」。

### 傻瓜式安装（每端三步）

**DSH 用户**

1. 下载 `dsh-plugin-0.2.0.zip`，解压
2. 把 `dsh-plugin/` 整个目录复制到 `<你的 DSH 配置目录>/profiles/<profile>/local-plugins/dsh-srelay-brief/`
3. **重启 DSH** → 新开会话，开场应出现 📋 看板 / 决策行

（Windows 上 DSH 配置目录一般在 `C:/Users/<你>/.dsh/`；profile 常见是 `web` 或 `desktop`。）
包内 `README-INSTALL.md` 有同一份步骤 + 排障表。

**ZCode 用户**

1. 下载 `zcode-adapter-1.0.0.zip`，解压
2. 在解压出来的 `zcode-adapter/` 里跑两条命令：

```bash
node install.mjs            # 先看计划，不写任何东西（dry-run）
node install.mjs --apply    # 真装：拷文件 + 注册 SessionStart hook
```

3. 在真实项目目录里跑一次 `brief.mjs` 验收，或直接新开会话看有没有 📍项目状态简报

（安装器会**先备份**你的 ZCode 配置，失败了能精确恢复。）

---

## 它解决什么问题

命令行 AI（ZCode、Claude Code…）的工作目录天然等于项目根，开场读一次项目状态是顺手的事；
**桌面端 AI（DSH）三条常规信号全断**——你换个窗口继续干活，它对项目既有的决策一无所知。

更麻烦的是**静默半失效**：装了一个看起来正常的记忆插件，命令成功、库建好了、自检全绿——
而你的会话**永远采不进来，全程零报错**。这个仓库里几乎每一处设计，
都是被这类「绿着的坏」逼出来的（详见 [docs/ENGINEERING-NOTES.md](docs/ENGINEERING-NOTES.md)）。

## 三个核心能力

**1. 每轮自动带上项目简报**（DSH 侧）
不是写死在文件里，而是**每个模型步骤前现查一次记忆库**——这一轮你做的决定，下一轮它就知道。
简报限 1200 字符，走 SQL 直查：冷路径约 5ms，而调 CLI 子进程要 310–360ms。

**2. 开场自动注入**（ZCode 侧）
SessionStart hook 组装简报塞进会话开场。任何失败 = 空输出 = 不阻塞会话。

**3. 一个项目一个库，永不合并**
`<项目>/.sessionrelay/relay.sqlite`，SQLite + FTS5，中文分词（jieba / bigram 可选）。
隐私边界就是文件边界：删掉目录即彻底消失。

---

## 三分钟装上（源码方式）

> 完整步骤（含离线、沙箱验证、卸载回滚）：**[INSTALL.md](INSTALL.md)**

```bash
# 1) 内核：装到全局（两个客户端共用）
cd packages/core && npm install && npm run build && npm i -g .

# 2) 给某个项目建记忆库
cd /path/to/your-project && srelay init

# 3) 选你的端（见上面「傻瓜式安装」）
```

**完全离线**（新机器、无 npm、无网络）：用 Release 里的全家桶，见 [release/README.md](release/README.md)。

---

## 仓库结构

```
packages/core/            核心库（TypeScript）：采集 → 提取 → 检索 → 归档 → MCP
packages/dsh-plugin/      DSH 插件（vendor 由 Release 包提供）
packages/zcode-adapter/   ZCode SessionStart hook + 一键安装器
skills/handoff-atlas/     交接与全资源地图技能（含锚点审计、地图生成器）
tools/                    安装器 / 重建 / 一致性守门 / 召回探针 / 客户端打包
docs/                     架构、工程笔记、常见问题
release/                  离线包与客户端包说明、发布清单
```

## 实测数字（不是宣传语）

| 项 | 数字 | 怎么来的 |
|---|---|---|
| 简报取数 | 冷路径 **~5ms** / 热路径 ~1ms | SQL 直查 vs CLI 子进程 310–360ms |
| 单库规模 | 583 会话 / 43,253 条消息 | 真实项目库 |
| 关键词检索命中 | **20/20** 进 top-10 | `tools/ses-recall-probe.mjs` 20 问基准 |
| 大白话检索命中 | 17/20 进 top-10（**top-1 仅 10/20**） | 同上——这是本项目的已知短板，写在明处 |
| 提取规则版本 | EXTRACT_VERSION = **18** | 每次改规则都要能重算存量 |
| 一致性守门 | A–I **九段全绿** | `tools/check-versions.mjs` |

## 与上游的关系

上游骨架（旁路捕获 / 规则提取 / SQLite+FTS5 / 三反幻觉 / 删除权在人）**一行没动**，全部是增量：
DSH 适配器、第六采集源 `dsh`、自动归档、提取质量八层防线、跨端简报、项目判定、
`srelay doctor` 体检、多副本一致性守门。

**不追求与上游合并**——本项目按自有仓库独立发展。上游版权与许可完整保留（见 [LICENSE](LICENSE)）。

## 许可

MIT。上游 © EwanJasper，本仓库改造部分 © rui08984-dot。
