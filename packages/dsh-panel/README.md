# dsh-srelay-panel · 记忆台

DSH **原生面板**：左栏多一个「记忆台」图标按钮，点开是主面板 —— 本机各项目的 SessionRelay 记忆
（对话/结论/待定/经验）、压缩图谱、设置页（28 个旋钮）、白名单动作。

## 怎么装（一条命令）

~~~bash
node tools/ses-panel-install.mjs            # dry-run：只说会做什么
node tools/ses-panel-install.mjs --apply    # 真装（web profile；--profiles web,desktop 可多装）
~~~

装完**必须重启 DSH**（客户端插件在宿主启动时加载）。自检：

~~~bash
curl http://127.0.0.1:19387/srelay/api/diagnostics   # coreLoaded:true、driver:"node:sqlite"
node integrations/dsh-srelay-panel/selftest.mjs      # 45 项真 HTTP（不需要重启 DSH）
~~~

## 它由什么组成

| 半边 | 文件 | 干什么 |
|---|---|---|
| 宿主 | `lib/index.js` | 注册 HTTP 前缀路由 `/srelay/api`（+ 旧别名 `/srelay-panel/api`）与命名服务 `ctx.provide('sessionrelay')`；白名单动作在子进程里跑（不阻塞 DSH UI） |
| 客户端 | `lib/client.js` | 往 `sidebar.panellist`（list/root）注册图标、往 `main`（keyed/root）用同一 id 注册主面板；React 组件：总览 / 经验 / 压缩 / 设置 / 动作 |
| 内核 | `vendor/dist/panel.js` | **唯一取数实现**（来自 `core/SessionRelay/src/panel/*`）。由 `ses-panel-install.mjs` 从内核 dist 同步，**不进 git** |

---

## 客户端 ↔ 宿主接口契约

宿主通过 DSH `ctx.webServer` 注册前缀路由 `/srelay/api`（及兼容别名 `/srelay-panel/api`），同时发布命名服务 `ctx.provide('sessionrelay', { id, route, ...METHODS })`。

### 统一响应封套格式 (Envelope)
所有请求（GET/POST）返回状态码 200/400/404/405/500，正文均为 UTF-8 JSON：
```jsonc
// 成功响应
{
  "ok": true,
  "method": "overview",
  "data": { /* 业务数据对象 */ }
}

// 失败响应（容错不许静默，必有 error 说明）
{
  "ok": false,
  "method": "overview",
  "error": {
    "code": "failed",       // "no-method" | "rejected" | "failed" | "method-error" | "bad-json"
    "message": "错误原因详细说明"
  },
  "coreError": null         // 若内核 dist/panel.js 未加载，此字段给出诊断原因
}
```

### 接口方法清单

#### 1. `overview` (GET / POST)
读取本机各项目总览数据、全局经验层状态、后台巡检生命周期及守护心跳。
- **参数**：
  - `focus`（可选，string）：仅聚焦指定项目路径；留空返回全部注册项目。
- **返回 `data` 形状**：
  - `generatedAt` (ISO 时间戳)
  - `driver` ("node:sqlite" 等)
  - `totals`: `{ projects, sessions, messages, decisions, unresolved, archived, dbBytes }`
  - `projects`: `Array<PanelProject>`，含项目名、root 路径、sessions、decisions、messages、archived、dbBytes、lastEventAt、daemonAlive、ok、error
  - `lessons`: `PanelLessons`（见 `lessons` 接口说明）
  - `lifecycle`: `PanelLifecycle`（见 `lifecycle` 接口说明）
  - `watchdog`: `{ online: boolean, ageMs: number | null }`（守护在线判定：心跳 age < 15 分钟）
  - `semantic`: `{ runtime, summary, note }`（语义检索引擎运行期加载状态）
  - `errors`: `string[]`（所有读不到的项目或异常，绝不静默吞掉）
  - `criteria`: `Record<string, string>`（铁律 22：每个数字的 SQLite 统计口径说明）

#### 2. `compression` (GET / POST)
查看指定项目库的 L0~L3 压缩分层现状及 ADR-003 老化计划。
- **参数**：
  - `root` (必填，string)：项目根路径。
  - `deep` (可选，boolean/string)：`true`/`1` 时执行 `compactExactSessions(apply:false)` 全量干跑测量，否则仅读现有证据。
- **返回 `data` 形状**：
  - `root`, `generatedAt`, `deep`
  - `l0`: `{ dupEntries, merged, changedSessions, bytesBefore, bytesAfter }`
  - `l2`: `{ rounds, archived, skipped, bytesFreed, lastAt, latest: Array<{ at, sessions, bytesFreed, criteria }> }`
  - `aging`: `{ hotDays, workflowDays, cap, hotGate, workflowGate, planned, plannedWorkflow, plannedHot, kept, topReasons, strengthBuckets }`
  - `layers`: `Array<{ id, name, kind, status: 'on'|'off'|'rejected'|'todo', note }>`

#### 3. `config` (GET / POST)
获取指定项目的全部可调配置旋钮（28 个）及当前值的生效来源层。
- **参数**：
  - `root` (必填，string)：项目根路径。
- **返回 `data` 形状**：
  - `root`, `configFile`, `hasFile`, `schemaVersion`
  - `knobs`: `Array<KnobState>`，每项包含：
    - `path` (如 "archive.hot_days")
    - `label` (人话标题)
    - `type` ("boolean" | "number" | "enum" | "string" | "string-list")
    - `value` (当前生效值)
    - `source` ("env" | "config" | "default")
    - `envValue` (当 source=env 时的环境变量文本)
    - `options`, `min`, `max`, `step`, `envVar`, `hint`, `warning`

#### 4. `applyConfig` (POST)
修改指定项目的配置旋钮并持久化至 `<project>/.sessionrelay/config.json`。
- **参数**：
  - `root` (必填，string)：项目根路径。
  - `patch` (必填，object)：修改的键值对 `{ "archive.hot_days": 45 }`。
- **返回 `data` 形状**：
  - `ok`: boolean
  - `changed`: `string[]`（成功修改的路径数组）
  - `rejected`: `Array<{ path: string, reason: string }>`（若有任何非法项，整批拒绝不写入）
  - `warnings`: `string[]`（业务提醒，如更换分词器后提醒重算）
  - `error`: `string | null`

#### 5. `lessons` (GET / POST)
读取全局经验库（`~/.sessionrelay/global.sqlite`）。
- **参数**：
  - `limit` (可选，number，默认 200)。
- **返回 `data` 形状**：
  - `total`, `injectable`, `admissionRate`, `threshold`
  - `byStatus`: `{ verified, candidate, ... }`
  - `byGrade`: `{ standard, core, inferred, ... }`
  - `byScope`: `{ global, project, ... }`
  - `items`: `Array<{ id, text, grade, scope, status, domain, live, injectable, needsReview, createdAt, uses, hits }>`

#### 6. `lifecycle` (GET / POST)
查看全局生命周期调度状态。
- **返回 `data` 形状**：
  - `rounds`, `lastAt`, `stages`: `Array<{ id, label, weight, everySec, ok, note, at, ms, fails }>`
  - `dueNow`: `string[]`（当前到期应跑的阶段 ID）
  - `heartbeat`: `Array<{ key, at, ageMs }>`
  - `recent`: `Array<{ at, stage, level, message }>`（健康巡检事件流水）

#### 7. `actions` (GET / POST)
获取允许跑的维护动作白名单及宿主 CLI 执行体检测状态。
- **返回 `data` 形状**：
  - `actions`: `Array<{ id, title, desc, writes: boolean }>`
    - 白名单 5 项：`scan` (doctor，只读), `sync` (采新对话，会写), `recompute` (按新规则重算，会写), `compact` (L0去重，会写), `clean` (清派生脏数据，会写)
  - `cli`: `string | null`（CLI 文件路径）
  - `cliHow`: `string | null`（来源：环境变量天窗或兄弟插件）
  - `running`: `string | null`（当前正在并发执行的动作 ID，排他互斥）
  - `cliHint`: `string | null`

#### 8. `run` (POST)
在宿主子进程中异步执行白名单动作（ADR-002：绝不阻塞 DSH 宿主主线程）。
- **参数**：
  - `op` (必填，string)：动作 ID。
  - `apply` (可选，boolean)：必须为 `true` 才能执行 `writes: true` 的写动作。
- **返回 `data` 形状**：
  - `ok`: boolean
  - `code`: number (进程退出码)
  - `durationMs`: number (执行耗时毫秒数)
  - `argv`: `string[]`
  - `out`: string (标准输出最后 8000 字符)
  - `err`: string (标准错误最后 2000 字符)
  - `error`: string | null

#### 9. `diagnostics` (GET / POST)
环境自诊断探针。
- **返回 `data` 形状**：
  - `panelVersion`, `node`, `route`, `routeAlias`, `vendorPanel`, `coreLoaded`, `coreError`, `driver`, `cli`, `cliHow`, `uptimeSec`

---

## 三条纪律（改这个插件前先读）

1. **不允许在本插件里写 SQL、阈值或判据**。所有数字来自 `vendor/dist/panel.js`；
   经验能不能进注入层调 `isInjectable`，淘汰计划调 `planAging` —— 与守护/CLI 同一份。
   守门：`node tools/check-panel-deps.mjs` + `core/SessionRelay/test/unit/panel-snapshot.spec.ts`。
2. **vendor 只需要 dist，不需要 node_modules**。`panel.js` 的静态 import 必须全是 node 内置
   （靠 `node:sqlite` 打开库）。一旦有人往那条链上挂 `better-sqlite3`/`@node-rs/jieba`，
   插件在 DSH 里会整块加载失败，而症状只是"面板没出现"。
3. **前端用相对地址取数**（`new URL('.', document.baseURI)`）。写死 `/srelay/api` 在反代子目录下会 404；
   Electron 壳里也不能用注入的 host origin（会变跨域）。依据见 `dsh-better-sidebar/src/client/host-route-url.ts`。

## 关掉它

~~~bash
rm -rf ~/.dsh/profiles/web/node_modules/dsh-srelay-panel   # 或从 profile 的 package.json 里删掉再 pnpm install
~~~

（`local-plugins/dsh-srelay-panel` 与 `.pnpm` 里的副本可一并删除；不影响记忆库本身。）
