# 发布清单（人工执行）

> 组装脚本**不建仓、不推送**。发布是人的动作，这里列出完整步骤与复核项。

## 0. 发布前复核（缺一条就别发）

- [ ] 工作区干净：`git status` 无未提交改动
- [ ] 内核测试全绿：`cd packages/core && npx vitest run`
- [ ] 一致性守门全绿：`node tools/check-versions.mjs`（A–I 九段）
- [ ] 发布树自检过：`node tools/ses-publish.mjs --out <目标>`（自检段无红）
- [ ] 离线包已重打且是最新：`node tools/ses-rebuild.mjs --pack`，sha256 与 `artifacts/LATEST.md` 一致
- [ ] 版本号已更新：`packages/core/package.json` / `packages/dsh-plugin/package.json`
- [ ] README 里的数字是**当前快照**（不是两周前抄的）

## 1. 组装发布树

```bash
node tools/ses-publish.mjs --out D:/sessionrelay-eco --git
```

## 2. 建仓并推送

```bash
cd D:/sessionrelay-eco
gh repo create <owner>/<repo> --public --source . --remote origin --push
```

> ⚠️ **公开前确认**：发布树里**不含**内部交接文档、不含 `.sessionrelay/` 记忆库、
> 不含任何本地绝对路径写死的配置。组装脚本已按规则排除，但**人还是要看一眼**
> （`git ls-files | grep -i handoff` 应为空）。

## 3. 挂 Release 资产

```bash
gh release create v<版本> --title "v<版本>" --notes-file <说明.md> \
  artifacts/ses-offline-<日期>-<时间>.zip
```

Release 说明里**必须**给出离线包的 sha256。

## 4. 发布后核对

- [ ] 在**另一台机器 / 干净目录** clone 下来，按 INSTALL.md 走一遍（真的能装起来）
- [ ] Release 资产可下载且 sha256 对得上
- [ ] README 里的相对链接在 GitHub 上都能点开
