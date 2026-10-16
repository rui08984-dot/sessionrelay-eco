# tools/ 脚本索引（2026-10-15 深夜整理）

> 这份索引不改动任何脚本——**只是把"哪个是常驻守门、哪个是一次性探针"说清楚**。
> 动手前先看这里，避免把一次性探针当生产工具用（它们大多硬编码了本机绝对路径）。

## 常驻守门（改完代码必须跑，别删）

| 脚本 | 用途 |
|---|---|
| `check-versions.mjs` | 5 份 CLI 运行时 md5 + 插件源码逐文件比对 + 守护是否跑当前代码 + 各项目采集源是否含 dsh |
| `check-brief-filters.mjs` | 两侧简报过滤器 / 名额一致性（退出码非零即漂移） |

## 全部脚本

| 文件 | 性质 | 首行注释 |
|---|---|---|
| `_mirror_dist.mjs` | **部署工具**（改完核心库必跑） | 把核心库 dist 镜像到全部运行时副本：md5 比对 + **删陈旧 chunk**（hash 命名，不删就会 52→87 个文件） |
| `_mirror_plugin.mjs` | **部署工具**（改完插件必跑） | 把改动过的插件文件镜像到全部副本（含 `.pnpm` 硬链接那两份），只拷内容不同的 |
| `_probe2.py` | 一次性探针 |  |
| `_probe_bigram_ab.mjs` | 一次性探针 | 一次性探针：jieba vs 纯 unigram+bigram 的检索质量 A/B。 |
| `_probe_bigram_ab2.mjs` | 一次性探针 | 一次性探针：抽样"只有 jieba 命中、bigram 没命中"的结果，人工判读是有用相关还是噪声。 |
| `_probe_bigram_ab3.mjs` | 一次性探针 | 一次性探针（第三版）：分词器的决定性测量。 |
| `_probe_bigram_real.mjs` | 一次性探针 | 一次性探针：用真实引擎验分词器差异。 |
| `_probe_brief_budget.mjs` | 一次性探针 | 简报预算精确拆解：决策/未决/看板三段分别占比（ZCode 侧真实渲染） |
| `_probe_brief_consts.mjs` | 一次性探针 | 简报预算实测：ZCode 侧 hook 的简报渲染（brief-shared.mjs） |
| `_probe_brief_parity.mjs` | **对拍工具**（check-versions H 段已常驻化） | `srelay brief` vs 两条老命令逐字段对拍 + 与插件 queryRecentFiles 同规 + 计时 |
| `_probe_brief_dsh.mjs` | 一次性探针（**可反复用**） | DSH 侧简报实测（走生产 apply() 注册链路）：总长/分段长/冷路径耗时 + 逐行 |
| `_probe_cli_spawn.mjs` | 一次性探针 | srelay 子进程成本基线（ZCode 侧每轮要付的钱） |
| `_probe_count_kind.mjs` | 一次性探针 |  |
| `_probe_coverage.mjs` | 一次性探针 | 覆盖度盘点：现有抽取分类够不够，有没有信息在丢。 |
| `_probe_engine_baseline.mjs` | 一次性探针 | 量真实引擎当前的返回数（改造前基线），再改造后重跑对比 |
| `_probe_last_event_at.mjs` | 一次性探针 | `last_event_at` 是活动时刻还是同步时刻（与 `synced_at` 对比 + 取值分布） |
| `_probe_mcp_schema_size.mjs` | 一次性探针 | Phase 1 集成效果实测：MCP 检索工具 5→2 的 schema 体积对比 |
| `_probe_mcp_serve.mjs` | 一次性探针 | 验证 srelay serve 能被 MCP 客户端正常拉起（模拟 ZCode 的 stdio 拉起方式） |
| `_probe_negative.mjs` | 一次性探针 | 一次性探针：量"否定/失败判定"抽取规则的精度。不写库，只打印样本供人工判读。 |
| `_probe_phase1_map.mjs` | 一次性探针 | Phase 1 · 记忆地图精度门禁：topics 聚合 + 停用词过滤后的可用率 |
| `_probe_phase2_narrow.mjs` | 一次性探针 | Phase 2 Phase 0 追加：测"收紧变体"能否达到 90% 门禁 |
| `_probe_phase2_precision.mjs` | 一次性探针 | Phase 2 Phase 0 · 真实库精度测量（决定接不接库的硬门禁） |
| `_probe_phase3_blast.mjs` | 一次性探针 | Phase 3 量化：多少"决策"来自子代理/任务提示词会话（标题是任务书的会话） |
| `_probe_phase3_fixab.mjs` | 一次性探针 | Phase 3 根因测量②：两个候选修复的爆破半径与误伤 |
| `_probe_phase3_layer1.mjs` | 一次性探针 | Phase 3 层① 判据迭代：v1 太窄（漏 "请精读…"），v2 扩族后重量误伤面 |
| `_probe_phase3_patterns.mjs` | 一次性探针 | Phase 3 根因测量（生产同源）：逐模式量 DECISION_RES 的命中量与误报形态 |
| `_probe_phase3_quotes.mjs` | 一次性探针 | Phase 3 根因测量③：未配对引号 / 反引号 作为"散文碎片"的结构信号 |
| `_probe_phase3_residual.mjs` | 一次性探针 | Phase 3 根因测量④：剩余散文噪声的判别信号（引文截断标记 / 元话语词） |
| `_probe_phase3_residual2.mjs` | 一次性探针 | Phase 3 最后一次残差测量：引文省略号 / 未决问题残片 / 尾部反引号 |
| `_probe_phase3_rootcause.mjs` | 一次性探针 | Phase 3 根因测量：decisions 的来源消息角色分布 |
| `_probe_phase3_simulate.mjs` | 一次性探针 | Phase 3 落地前模拟 v2：层① + Fix A（摘"不用"）+ Fix B（引号配对守卫）叠加后简报显示什么 |
| `_probe_phase3_verify.mjs` | 一次性探针 | 重算后核验：Fix A / Fix B 的样本是否真的从库里消失了 |
| `_probe_recentfiles_rank.mjs` | 一次性探针 | 「最近在动」的排名判别力：频次信号 / 特异度权重 / basename 合并 |
| `_probe_recentfiles_signal.mjs` | 一次性探针 | 「最近在动」的口径对照：会话决策总和 vs 文本含文件名 + 并列诊断 |
| `_probe_srelay.py` | 一次性探针 |  |
| `_probe_trace_noise.mjs` | 一次性探针 | 追溯简报里 4 条决策的来源会话与原始消息，确认它们是不是审稿报告碎片 |
| `_probe_z3.py` | 一次性探针 |  |
| `_probe_z4.py` | 一次性探针 |  |
| `_probe_z5.py` | 一次性探针 |  |
| `_probe_zcode.py` | 一次性探针 |  |
| `_verify_report2_batch1.mjs` | 一次性探针 | 核验批次 1：lineage（HTML 实体解码能否消灭 quot 污染）+ lexicon（治"修一半"） |
| `_verify_report2_batch2.mjs` | 一次性探针 | 核验批次 2：env-facts（宣称精度 92%+）——这是 Phase 2 能否解禁的关键 |
| `_verify_report2_batch3.mjs` | 一次性探针 | 核验批次 3：brief-kernel 过滤器 + runtime-contract 别名/断言 + hybrid-search 两阶段 MSM |
| `_verify_report2_batch4.mjs` | 一次性探针 | 核验批次 4：hybrid-search 两阶段 MSM（真实 FTS5）+ zstd-frame-reader（真实 DSH 文件） |
| `_verify_report2_batch5.mjs` | 一次性探针 |  |
| `_verify_report2_claims.mjs` | 一次性探针 | 核验外部报告 #2 的核心断言：它的 speech-act-guard 三个模块 |
| `_verify_report2_compare.mjs` | 一次性探针 | 对比：我们现有的 quotesBalanced vs 报告的 quotesBalancedAndPolarized |
| `_verify_report2_extract.mjs` | 一次性探针 | 批量核验外部专家方案的生产模块 |
| `_verify_report2_killed.mjs` | 一次性探针 | 逐条列出被报告的引号极性守卫拦掉的现有决策，供人工判读误杀率 |
| `check-brief-filters.mjs` | **常驻守门** | !/usr/bin/env node |
| `check-versions.mjs` | **常驻守门** | !/usr/bin/env node |
| `probe-dsh-session.mjs` | 一次性探针 | 一次性探针：解包 DSH 会话文件（zstd 多帧），验证 (a) 简报是否注入 (b) session.header.cwd 是否非空 |

## 使用纪律

- **改完核心库源码并重建后，跑一次 `tools/_mirror_dist.mjs`**（权威源 = `core/SessionRelay/dist`，
  8 个副本一次对齐；**注意重建前必须先删 dist**，否则 tsup 会留下陈旧 chunk）。
- **改完 `plugins/dsh/` 里任何文件，跑一次 `tools/_mirror_plugin.mjs`**（铁律 #13：新增/删除文件必须显式镜像；
  改老文件虽经硬链接同步，但 profile 那 4 份是独立拷贝，不镜像 `check-versions` 的 B 段会当场报红）。

- 一次性探针**不许**直接用结果下结论：它们大多在**手选样本**上跑，本轮项目已被这个坑咬过三次（ADR-002）。
- 探针里凡是"import 生产正则"的，别在本机复制一份再改——那会让探针与生产分叉（项目铁律：探针必须 import 生产实现）。
