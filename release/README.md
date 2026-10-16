# Release 资产

## 三个包，按需取

| 包 | 给谁 | 大小 | 怎么装 |
|---|---|---|---|
| **dsh-plugin-\<版本\>.zip** | DSH 用户 | ~20MB | 解压 → 整个目录丢进 `profiles/<profile>/local-plugins/dsh-srelay-brief/` → **重启 DSH** |
| **zcode-adapter-\<版本\>.zip** | ZCode 用户 | ~21KB | 解压 → 在目录里跑 `node install.mjs --apply` |
| **ses-offline-\<日期\>.zip** | 两个都用 / 新机器一次装齐 | ~20MB | 见下 |

生成这三个包：`node tools/ses-pack-clients.mjs`（前两个）+ `node tools/ses-rebuild.mjs --pack`（全家桶）。
sha256 台账在 `artifacts/RELEASE-ASSETS.md` 与 `artifacts/LATEST.md`。

---

## 全家桶（ses-offline）是什么

一个 zip，装下"新机器、无网络、无 npm"也能把整套装起来所需要的一切：

| 内容 | 说明 |
|---|---|
| `core-dist/` | 核心库构建产物（覆盖到已装 CLI 的 `dist/`） |
| `plugins/dsh/` | DSH 插件**连 vendor**（自包含运行时：better-sqlite3 四平台预编译 + jieba 词库） |
| `zcode-adapter/` | ZCode 适配器（含一键安装器） |
| `skills/` | handoff-atlas 交接技能 |
| `tools/` | 安装器 / 重建 / 一致性守门 |
| `README-OFFLINE.md` | 包内说明：逐目录用法 + 三条验收 |

**不需要**：npm install、联网、本机预装 SessionRelay。

## 怎么拿

1. 到本仓库 **Releases** 页下载 `ses-offline-<日期>-<时间>.zip`
2. 核对 sha256（Release 说明里给出）
3. 解包，按包内 `README` 走

**离线包不进 git**：二进制会永久留在 git 历史里，且每次重建产生一个新版本。
它作为 **Release 资产**发布——仓库保持轻，用户拿到的仍是完整离线包。

## 怎么自己打一个

```bash
# 在开发工作区里
node tools/ses-rebuild.mjs --pack      # 干净重建 → 镜像 8 份副本 → 三守门 → 打离线包
```

产出：`artifacts/ses-offline-<日期>-<时间>.zip`，并自动把 sha256 写进 `artifacts/LATEST.md` 台账。
**每次改完代码都要重打**，否则你手里的是旧包（这正是"部署的版本是不是最新"要盯的事）。

## 装它（离线）

```bash
# 1) 内核：把 core-dist 覆盖到已装 CLI 的 dist/（若无全局安装，先按 INSTALL.md A 装一次内核）
# 2) DSH 插件：把 plugins/dsh 整个目录覆盖到 profile 的 local-plugins/dsh-srelay-brief/
# 3) 重启 DSH
```

回退：覆盖前先备份目标目录；安装器 `--uninstall` 也能按安装时留下的备份精确恢复。
