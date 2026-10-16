# tools/ 说明

这些是**维护者工具**，不是给最终用户的。分两类：

## 可移植（谁都能用）

| 脚本 | 用途 |
|---|---|
| `ses-install.mjs` | 一键安装/卸载到本机（默认 dry-run；`--apply` 才动手；`--pack` 打离线包） |
| `ses-rebuild.mjs` | 干净重建 → 镜像所有副本 → 跑守门 → 可选打离线包 |
| `ses-publish.mjs` | 组装对外发布树（本文件所在仓库就是这么来的） |
| `ses-recall-probe.mjs` | 20 问检索召回基准（关键词臂 vs 大白话臂），产出可复算的数字 |
| `ses-purge-injected.mjs` / `ses-fix-message-count.mjs` | 数据修正工具（历史遗留问题的清理） |

## 绑定本机布局（换了机器要改路径）

| 脚本 | 为什么绑本机 |
|---|---|
| `check-versions.mjs` | 它的任务就是对比**本机**的多份副本（作者副本 / 各 profile / .pnpm 硬链接副本），路径按本机布局写死 |
| `check-brief-filters.mjs` | 同上：对拍 DSH 侧与 ZCode 侧两份过滤规则 |
| `_mirror_dist.mjs` / `_mirror_plugin.mjs` / `_mirror_skills.mjs` | 镜像到本机的各个加载路径 |

**为什么要发这些"绑本机"的脚本**：它们记录了本项目最重要的一条工程纪律——
**同一份代码存在多个加载路径，而用户永远在看其中一个**。
"作者副本是新的、加载副本停在昨天"这类静默故障，只能靠对拍抓住。
