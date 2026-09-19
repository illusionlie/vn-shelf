# Backend Conventions

> `src/` Worker 后端的可执行契约。违反这些约定的 PR 应在 check 阶段被拦下。

---

## Scenario: 公开端点 CORS 策略

### 1. Scope / Trigger

- Trigger：任何新增/修改 API 路由、或改动 `src/router.js` 中 `handleRequest` 出入口逻辑的变更。
- 本项目前后端同源（同一 Worker），CORS **只为第三方只读消费**存在，不为自身前端服务。

### 2. Signatures

```js
// src/router.js（模块级）
const PUBLIC_CORS_PATH_PATTERNS = [
  /^\/api\/vn$/,
  /^\/api\/vn\/v\d+$/,
  /^\/api\/stats$/,
  /^\/api\/tier$/,
  /^\/api\/config\/appearance$/
];
function isPublicCorsPath(path) // → boolean
```

### 3. Contracts

- 公开集合内的 `GET` 响应：`handleAPI` 返回后在 `handleRequest` 出口统一 `response.headers.set('Access-Control-Allow-Origin', '*')`，**不在各 handler 内逐个加头**。
- 公开集合内的 `OPTIONS`：204 + `Access-Control-Allow-Origin: *` + `Access-Control-Allow-Methods: GET, OPTIONS` + `Access-Control-Max-Age: 86400`。
- 认证 Cookie 为 `SameSite=Strict`，跨域认证不可行 → **认证类与写操作端点永远不加 CORS 头**，其 OPTIONS 自然落入路由得 404。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| OPTIONS 命中公开集合 | 204 + 三个 CORS 头 |
| OPTIONS 未命中 | 404，无 CORS 头 |
| GET 命中公开集合（含 404 业务响应，如条目不存在） | 响应附加 `Allow-Origin: *` |
| 非 GET 命中公开路径（PUT/DELETE `/api/vn/v\d+`） | 不加 CORS 头（出口条件限定 `method === 'GET'`） |

### 5. Good/Base/Bad Cases

- Good：新增公开只读端点时，同步把正则加入 `PUBLIC_CORS_PATH_PATTERNS` 并在测试矩阵补一行。
- Base：端点默认不公开、不带 CORS——什么都不做即正确。
- Bad：为"修跨域问题"给全部路由加 `Allow-Origin: *` 预检（历史上存在过这种假 CORS，已在 2026-06 移除——预检放行但实际响应无头，纯误导）。

### 6. Tests Required

- `tests/router/config.update.test.mjs` 的 CORS 矩阵：公开五端点 OPTIONS=204+三头、GET 带 `Allow-Origin: *`；认证端点（`/api/config`、`/api/export`）GET 无 CORS 头、OPTIONS=404。新增公开端点必须扩展该矩阵。

### 7. Wrong vs Correct

```js
// Wrong：handler 内自己加 CORS 头（绕过统一出口，矩阵测试测不到）
async function handleGetFoo(request, env) {
  const res = jsonResponse(data);
  res.headers.set('Access-Control-Allow-Origin', '*');
  return res;
}

// Correct：只改 PUBLIC_CORS_PATH_PATTERNS，头由 handleRequest 出口统一附加
const PUBLIC_CORS_PATH_PATTERNS = [/* ... */, /^\/api\/foo$/];
```

---

## Scenario: settings 单请求复用契约（禁止跨请求缓存）

### 1. Scope / Trigger

- Trigger：任何需要读取 D1 `settings` 的新 handler，或改动 `authMiddleware` / `getSettings` 的变更。

### 2. Signatures

```js
// src/auth.js
authMiddleware(request, env)
// → { authenticated, user?, error?, settings? }
//   settings：本次已加载的配置对象；无 cookie 早退分支不加载、不附带。
//   authenticated === true ⟹ settings 必然存在。

verifyAdminPassword(settings, password) // 接收已加载的 settings，内部不再查库
```

### 3. Contracts

- 认证 handler 在 `auth.authenticated` 为真后**必须复用 `auth.settings`**，不得再 `await getSettings(env)`。
- 例外：写入密码/jwtSecret 后（`setAdminPassword`）必须重读 settings 再签发 JWT（`handleUpdateConfig` 现状）。
- `fetchVNDB`（queue 消费场景，无 auth 上下文）自行 `getSettings`，不受此契约约束。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 无 cookie | `{ authenticated: false, error: 'No token' }`，无 settings 字段 |
| jwtSecret 未配置 / token 无效 | `authenticated: false` + 携带 settings |
| 测试桩 authMiddleware | 必须同步附带 `settings`（见 `tests/router/config.update.test.mjs` 的桩） |

### 5. Good/Base/Bad Cases

- Good：handler 写 `const settings = auth.settings;`。
- Base：公开 handler（无 auth）单次 `getSettings`，不缓存。
- Bad（**禁止**）：以 `env` 为 key 的 WeakMap/模块级缓存 settings。**Why**：Workers 的 `env` 对象在同一 isolate 内跨请求复用，缓存会让"改密码/换 jwtSecret"在其他 isolate 长时间不生效——旧 token 在部分实例上仍然有效，属安全窗口。

### 6. Tests Required

- 改动 authMiddleware 返回结构时：`tests/router/config.update.test.mjs` 桩的 `settings` 字段需同步，断言 handler 在认证路径不额外调用 getSettings（可用桩计数）。

### 7. Wrong vs Correct

```js
// Wrong：跨请求缓存（多 isolate 旧密钥窗口）
const settingsCache = new WeakMap();
async function getSettingsCached(env) {
  if (!settingsCache.has(env)) settingsCache.set(env, await getSettings(env));
  return settingsCache.get(env);
}

// Correct：单请求内沿调用链复用
const auth = await authMiddleware(request, env);
if (!auth.authenticated) return errorResponse('未授权', 401);
const settings = auth.settings;
```

---

## Scenario: API 响应信封（B6c/A3 统一后契约）

### 1. Scope / Trigger

- Trigger：任何新增/修改 API 路由的返回体，或改动 `src/utils.js` 响应辅助函数的变更。
- 2026-07（B6c）起全部 25 条公开路由统一信封；此前 6 条裸出端点已收编，**新路由不得再走裸 `jsonResponse`**。

### 2. Signatures

```js
// src/utils.js
successResponse(data = null, message = '操作成功', extra = {})
// → jsonResponse({ success: true, message, data, ...extra })，恒 200
errorResponse(message, status = 400)
// → { success: false, error: message }，无 code、无 data
jsonResponse(data, status, headers)   // 底层序列化通道，公开路由不得直接用它裸出业务数据
```

### 3. Contracts

- 成功：`{ success: true, message?: string, data: <payload>, ...extras }`。`success`+`data` 必备；`message` 可选且**前端零消费**（纯信息性）；`extras` 仅列表端点顶层散字段（`GET /api/vn` 带 `total`；`GET /api/tier` 带 `total`+`updatedAt`）。
- 错误：`{ success: false, error: string }` —— **无 `code`**。前端 `friendlyErrorMessage` 的 4xx 分支依赖"无 code + 中文 message 透传"；`createApiError` 硬依赖字段名 `error`。加 code = 把 4xx 文案来源切到前端 locale 映射，是方向性变更，必须独立任务显式决策。
- 前端消费规则：组件层统一 `res.data` 解构；**禁止 `res.data || res` 类形态兜底**（B5a 已清零，B6c 后无存在理由）。
- 导出特例语义：`GET /api/export` 的 data 层即导出文件内容（`{version,exportedAt,entries,tierList,appearance}`）——前端存 `res.data`，文件格式与 import 端及历史备份兼容。
- 豁免：`IndexStartLockDurableObject` 内部端点（`{acquired}/{released}/{lock}`，Worker↔DO 通信，前端不消费）。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 新公开路由成功返回 | 必走 `successResponse`（列表散字段用第三参 `extra`） |
| 业务错误 | `errorResponse(中文友好文案, 4xx)` —— message 原样出前端 toast |
| 未捕获异常（index.js 顶层） | `errorResponse('Internal Server Error', 500)`（勿手写复刻） |
| 路由未命中 | `errorResponse('Not Found', 404)` |

### 5. Good/Base/Bad Cases

- Good：列表端点 `successResponse(items, undefined, { total: items.length })`——data 恒为数组，散字段顶层。
- Base：普通端点 `successResponse(entry)` / `successResponse(null, '删除成功')`。
- Bad（禁止）：`jsonResponse({ data: items, total })` 裸出（无 success，B6c 前的历史形态）；`jsonResponse(entry)` 裸对象；错误响应塞 `code` 字段。

### 6. Tests Required

- `tests/router/envelope.test.mjs`：6 个原偏离端点的信封形态断言（含 export 的 data 五键精确 `deepEqual`、404 错误信封无 code）。新增公开路由应在此补形态用例。
- **测试桩镜像纪律**：`config.update.test.mjs` 与 `index.start.test.mjs` 内的 utils 桩必须与真实 `successResponse/errorResponse` 逐行为等价——改 utils 签名/形态时同步两桩，否则假绿。更稳的形态断言（如 envelope 测试）直接复制真实 `src/utils.js` 进 tempDir，不打桩。
- **源码 patch 型加载器的依赖图陷阱**（B6c 教训）：`tests/queue/index.queue.test.mjs` 以 patch 相对导入方式加载 `src/index.js`——给被加载源文件**新增 import 时必须同步 patch 列表**，否则 `ERR_MODULE_NOT_FOUND`。评估测试影响面时不能只看断言，要看依赖图。

### 7. Wrong vs Correct

```js
// Wrong：裸出 + 散字段与 data 平铺（B6c 前历史形态，禁止回潮）
return jsonResponse({ data: items, total: items.length });

// Correct：信封统一，散字段走第三参
return successResponse(items, undefined, { total: items.length });
```

```js
// Wrong：错误响应加 code（破坏 friendlyErrorMessage 的中文透传契约）
return jsonResponse({ success: false, error: '未授权', code: 'UNAUTHORIZED' }, 401);

// Correct
return errorResponse('未授权', 401);
```


---

## Scenario: D1 Schema 迁移（v0 基线冻结 + 版本化 MIGRATIONS）

### 1. Scope / Trigger

- Trigger：任何需要变更 D1 表结构（加列 / 加索引 / 新表）的任务，或任何改动 `src/db.js` 的变更。
- 机制来源：任务 `07-11-d1-migration`（2026-07-11）。schema 初始化走 Worker 运行时 `initDB()`，**不使用** wrangler d1 migrations 部署期方案。

### 2. Signatures

```js
// src/db.js
SCHEMA_SQL                 // v0 冻结基线（CREATE TABLE IF NOT EXISTS，永不再改表结构）
MIGRATIONS                 // [{ version, statements: ['<单行 SQL>'] }]，version 从 1 起连续递增
SCHEMA_VERSION_KEY         // 'schema_version'，settings 表保留键
LATEST_SCHEMA_VERSION      // 由 MIGRATIONS 推导（空数组 = 0）
readSchemaVersion(db)      // 缺失/非法 → 0
applyPendingMigrations(db, migrations, currentVersion)
```

### 3. Contracts

- **基线冻结不变量**：`SCHEMA_SQL` 永远停留在 v0，任何结构变更只能**追加** `MIGRATIONS` 条目。新装库同样走全量迁移回放——"缺 `schema_version` 键 = v0"是唯一语义，不存在新装/存量分叉。
- 单迁移原子：迁移 statements 与版本号 upsert 必须在**同一个** `db.batch` 内。
- 并发容忍：batch 失败 → 重读版本号，已 ≥ 目标版本视为他方已应用并继续；否则抛**原始**错误（重读自身失败时同样抛原始错误，禁止覆盖）。
- 版本连续性在任何语句执行前校验，跳号显式报错。
- 全部 SQL 单行书写、经 `prepare` + `batch`（D1 `db.exec()` 多行缺陷，见 db.js 头注 issue 引用）。
- `schema_version` 为 settings 表保留键，业务代码（getSettings/saveSettings 等）不得读写。
- 迁移只向前，无 down 脚本；回滚 = 重部署旧版 Worker 代码（全库显式列名读写，多余列无害）。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 全新库 | 基线建表 + 全部迁移按序回放，版本落 `LATEST_SCHEMA_VERSION` |
| 存量库（无版本键） | 视为 v0，应用全部待做迁移 |
| 已最新 | 仅一条版本 SELECT，零迁移语句执行 |
| 并发竞争败者（版本已被推进） | 静默继续，不报错 |
| batch 失败且版本未推进 | 抛原始迁移错误，WeakSet 不缓存失败态（下次可重试） |
| MIGRATIONS 跳号/非连续 | 执行前显式报错 |

### 5. Good/Base/Bad Cases

- Good：加列 = 追加 `{ version: N+1, statements: ['ALTER TABLE ... ADD COLUMN ...'] }` + `tests/d1/migrations.test.mjs` 补该迁移的应用断言。
- Base：不动表结构的变更无需理会本契约。
- Bad（**禁止**）：直接编辑 `SCHEMA_SQL` 里的 CREATE TABLE 加列——`IF NOT EXISTS` 使存量部署永远收不到该列，线上新旧 schema 静默漂移。
- Bad：慢迁移（大表数据回填）直接塞进 `initDB` 请求路径——需另行设计后台化方案，独立任务决策。

### 6. Tests Required

- `tests/d1/migrations.test.mjs`：机制用例采用**注入自定义迁移表**方式（不依赖真实 MIGRATIONS 内容）；新增真实迁移时补"该迁移在存量库上正确应用"的用例。
- 依赖 `initDB` 的既有套件（repository/router/queue）零回归确认。

### 7. Wrong vs Correct

```js
// Wrong：直接改基线加列（存量部署收不到）
const SCHEMA_SQL = [
  'CREATE TABLE IF NOT EXISTS vn_entries (id TEXT PRIMARY KEY, ..., status TEXT);'
];

// Correct：基线不动，追加迁移
const MIGRATIONS = [
  { version: 1, statements: ['ALTER TABLE vn_entries ADD COLUMN status TEXT'] }
];
```

---

## Convention: 条目游玩状态枚举（status）

**What**：`vn_entries.status` 为字符串枚举，白名单 `VN_STATUS_VALUES = ['playing','finished','stalled','dropped','wishlist']`（src/repository.js 导出），NULL = 未设置。`wishlist` 为**预留值**：后端全链路接受，前端编辑/筛选/徽章首期不暴露（展示层安全降级：无配色徽章不渲染，详情有防御性 locale key）。前端在 `vnShelf.js` 持有四值 UI 常量，与后端白名单注释互指同步。

**归一与校验分层**：`normalizeStatus()`（非法 → null）是持久化边界唯一归一点（`rowToEntry`/`entryToRow`/`rowToListItem` 三处生效）——导入走宽松归一不拒包；API（create/update）走严格白名单校验，非法 400 中文文案无 code。update 三态：字段缺省 = 保持、`null` = 清除、合法值 = 设置。

**Why**：为 VNDB ulist 导入预置落点（已于 07-12 兑现）。映射规则在任务 `07-11-entry-status` 固化：label `1→playing, 2→finished, 3→stalled, 4→dropped, 5→wishlist`；多标签单值化取终态优先 `2 > 4 > 3 > 1`；纯 Wishlist 条目跳过。映射常量已落 `src/vndb.js`（`ULIST_LABEL_TO_STATUS`/`STATUS_PRIORITY`），详见下方「VNDB ulist 导入管线」Scenario。

**Related**：`tests/router/vn.status.test.mjs`（校验矩阵）、`tests/d1/repository.test.mjs`（归一/宽松导入）、状态与 `finishDate` 无联动（显式决策，勿"顺手"加自动填充）。

---

## Scenario: VNDB ulist 导入管线（07-12 兑现）

### 1. Scope / Trigger

- Trigger：改动 `src/ulist-import.js`、`src/vndb.js` 的 ulist/authinfo 方法、或 `index_tasks` 表复用逻辑的变更。
- 07-11 预留的 status 枚举与映射规则在此兑现；映射常量已落 `src/vndb.js`（不再是"不预置"状态）。

### 2. Signatures

```js
// src/vndb.js
mapVnObjectToVndbData(vn)              // getVN 与 ulist 共享的 VN 元数据映射（回归保护）
mapUListItemToEntry(item)             // ulist 单条 → entry | { skip: true }
VNDBClient.request(endpoint, body, method='POST')  // GET 不带 body
VNDBClient.getAuthInfo()              // GET /authinfo，校验 listread
VNDBClient.fetchUList(userId, { page, results })   // POST /ulist，返回 { results, more }
// src/ulist-import.js
startUListImport(env, ctx)            // 鉴权 + 建任务，waitUntil 后台拉取
```

### 3. Contracts

- **映射规则唯一落点**：`ULIST_LABEL_TO_STATUS` + `STATUS_PRIORITY`（终态优先 `2>4>3>1`）常量在 `src/vndb.js`。纯 wishlist（仅 label5、无 1-4）→ `{ skip: true }`；无 1-4 但有其他标签 → status `null` 仍导入；`vote/10→personalRating`（vote 空→0，四舍五入一位小数）；`started/finished→startDate/finishDate`。
- **getVN 回归不变量**：`getVN` 必须委托 `mapVnObjectToVndbData`，输出逐字段与重构前一致（`tests/vndb/ulist-mapping.test.mjs` 对拍）。
- **request 方法参数**：默认 POST 保持 `/vn`、`/ulist` 行为；仅 `/authinfo` 传 `'GET'`，GET 不序列化 body。
- **任务表复用**：`index_tasks` 加 `type`（默认 `'index'`）与 `skipped` 列（迁移 v2）；`saveIndexStatus`/`getIndexStatus` 读写两列。导入任务 `type='ulist_import'`；进度查询复用 `GET /api/index/status`。
- **冲突策略**：已存在同 ID 条目跳过（计入 skipped），本地数据零改动；开始时预载已存在 id 集合到内存，逐条判断不查库。
- **启动互斥**：`POST /api/ulist/import` 复用 `INDEX_START_LOCK` Durable Object，与索引任务互斥（两者都写 vn_entries）；持锁仅覆盖鉴权 + 建任务同步窗口，后台拉取靠任务活跃态阻止重复启动。
- **执行模型**：`ctx.waitUntil` 分页循环 + 分批写入；单次墙钟/网络中断 → 记录已导入进度置 `partial`（已存在跳过 = 天然断点续传，重跑收敛）。

### 4. Tests Required

- `tests/vndb/ulist-mapping.test.mjs`：`mapUListItemToEntry` 全边界 + getVN 回归 + getAuthInfo/fetchUList 方法/body/错误分支 + request GET/POST。
- `tests/vndb/ulist-import.test.mjs`：跳过已存在 + skipped 计数 + 鉴权失败信封 + 分页汇总 + 写库失败 partial。
- `tests/d1/migrations.test.mjs`：v2 在存量 v1 库加 `type`/`skipped` 列。
- 路由 patch 型加载器（`config.update`/`envelope`/`vn.status`/`index.start`）新增 `./ulist-import.js` import 时必须同步 patch 列表与 stub，否则 `ERR_MODULE_NOT_FOUND`。

---

## Convention: wrangler 配置双轨（toml 被 gitignore）

**What**：`wrangler.toml` 含真实 D1 id 等敏感信息，被 `.gitignore` 排除；仓库内被跟踪的模板是 `wrangler.toml.example`。**任何绑定/变量/队列等配置变更必须同时改两份文件**，否则克隆者或 CI 拿到的模板与实际运行配置漂移。

**Why**：2026-06 审阅曾发现本地 toml 残留已删模块（KV 绑定、BACKGROUND 变量）而无人察觉——单轨修改是漂移的根源。

**环境变量契约**：

- `[vars] ENVIRONMENT = "production"` 是两份文件的默认值；本地开发由根目录 `.dev.vars`（被 git 跟踪，**禁止放真实秘密**）覆盖为 `development`，`wrangler dev` 自动读取。
- 代码侧安全默认：Cookie `Secure` 等安全开关一律写 `env.ENVIRONMENT !== 'development'`（默认安全，仅显式 development 豁免），**禁止** `=== 'production'` 判断（配置漏设即退化为不安全）。

**Example**：

```toml
# wrangler.toml 与 wrangler.toml.example 同步修改
[vars]
# 本地开发时由 .dev.vars 覆盖为 development（wrangler dev 自动读取 .dev.vars）
ENVIRONMENT = "production"
```

**Related**：`.dev.vars`、`src/router.js` 的 `setAuthCookie` 调用点。

---

## Convention: 统计聚合（/api/stats，07-20 起）

**What**：统计口径唯一落点是 `src/stats.js` 的 `computeStats(rows)` 纯函数（vn_entries 原始行 → 聚合对象，shape 与口径见模块头注）；`repository.getStats(env)` 只做宽 SELECT 取数装配。`getVNList` 已瘦身为仅返回 `{ items }`——stats 不再挂车列表查询，两端点各查各的。

**Why**：纯函数不依赖 D1 桩即可全边界测试（`tests/stats/compute.test.mjs`）；`/api/stats` 是公开 CORS 端点，聚合只出统计值与标题级信息，review 等明细不出库。

**扩展纪律**（新增统计字段时）：

1. `computeStats` 保持纯函数 + 单遍历累积；禁止在 repository/router 层散落聚合逻辑。
2. 宽 SELECT 加列必须同步 `tests/d1/repository.test.mjs` FakeD1 的对应 SQL 分支（mock 对未知 SQL 抛错，漏改会红）。
3. router 4 桩（envelope/config.update/vn.status/index.start）已含 `getStats` 导出；给 router.js 再新增 repository 导入时同样要四桩齐改（patch 型加载器依赖图陷阱）。
4. 口径变更同步三处文案：AGENTS.md 统计接口说明、`src/stats.js` 头注、前端 locales 的 `stats.aboutText`（zh-CN/en 双侧，key diff 测试强制）。

**既有口径决策**（勿"顺手"更改）：时间线按 `finish_date` 计数不看 status（沿用「状态与 finishDate 无联动」决策）；直方图 round 取整 clamp 1..10 仅计 >0；分歧榜样本 = 双评分均 >0、按 1 位小数舍入后过滤；条目时长整体记入完成月（近似口径）；日期脏数据跳过不抛错。

**Related**：`tests/stats/compute.test.mjs`、`tests/d1/repository.test.mjs`（getStats 装配）、`tests/router/envelope.test.mjs`（/api/stats 信封形态）、任务 `07-20-stats-page-expansion`。

---

## Scenario: VNDB 搜索代理端点（07-26）

### 1. Scope / Trigger

- Trigger：改动 `GET /api/vndb/search`、`VNDBClient.searchVN`，或新增任何「前端 type-ahead → Worker 代理上游 API」类端点时参照本契约。

### 2. Signatures

```js
// src/router.js
handleVndbSearch(request, env, auth)   // GET /api/vndb/search?q=<关键词>&limit=<1..20>
// src/vndb.js
VNDBClient.searchVN(query, limit = 10)
// → [{ id, title, original, released, image, imageNsfw, rating, developers }]
```

### 3. Contracts

- 认证端点：路由在 `authMiddleware` 之后；**不入** `PUBLIC_CORS_PATH_PATTERNS`，响应无 CORS 头。
- token 直取 `auth.settings.vndbApiToken` 后 `new VNDBClient(token)`——**禁止** `createVNDBClient(env)`（内部二次 `getSettings`，违反 settings 复用契约）。
- `q` trim 后必填，超 100 字符静默截断；`limit` 非法归 10、clamp 1..20（静默，不 400）。
- **searchrank 坑**：kana API 的 search filter 结果默认按 id 排序，必须显式 `sort: 'searchrank'` 才按相关度——漏掉时功能"看起来能用"但候选顺序几乎不可用。
- type-ahead 端点**不重试**（对比 `fetchVNDB` 的 3 次指数退避）：下一次击键即天然重试，重试只会放大延迟与 VNDB 配额消耗。
- `imageNsfw` 口径与 `mapVnObjectToVndbData` 一致（`sexual>1 || violence>1`），供前端 `nsfw-blur` 复用。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 未认证 | `errorResponse('未授权', 401)` |
| q trim 后空 | 400 中文文案 |
| token 未配置 | **400**（非 500）——4xx 才走前端 friendlyErrorMessage 的中文透传分支，文案指引去设置页 |
| VNDB 上游失败 | 500 `VNDB API错误: ...`（与 `handleCreateVN` 同形态） |
| limit 非法/越界 | 静默归 10 / clamp 1..20 |

### 5. Good/Base/Bad Cases

- Good：新增同类上游代理端点时复用「认证 + 无 CORS + settings 复用 + 输入静默 clamp + 上游错误 500」组合与本矩阵。
- Base：`searchVN` 仅服务本端点；改字段集需同步 `tests/vndb/search.test.mjs` 的请求体 deepEqual。
- Bad：handler 里 `createVNDBClient(env)`（双查 settings）；给 type-ahead 加重试；漏 `sort: 'searchrank'`。

### 6. Tests Required

- `tests/router/vndb.search.test.mjs`：401 信封 / q 空 400 / token 缺失 400 且不构造 client / 成功信封 + token 来源断言 + 无 CORS 头 / clamp（999→20、0→1、非法→10）/ trim+截断透传 / 上游失败 500。
- `tests/vndb/search.test.mjs`：请求体（filters/sort/fields/results）deepEqual + 映射边界（imageNsfw 三态、rating 0-100→0-10、缺省兜底、空结果）。
- router.js 新增 `VNDBClient` import → 四个 patch 桩（config.update/envelope/vn.status/index.start）必须同步 `export class VNDBClient`（依赖图陷阱，见 B6c 教训）。

### 7. Wrong vs Correct

```js
// Wrong：漏 searchrank（默认按 id 排序，相关度尽失）+ handler 内二次查 settings
const client = await createVNDBClient(env);
await client.request('/vn', { filters: ['search', '=', q], fields, results: limit });

// Correct：settings 复用 + 显式相关度排序
const client = new VNDBClient(auth.settings.vndbApiToken);
await client.request('/vn', { filters: ['search', '=', q], fields, sort: 'searchrank', results: limit });
```

---

## Scenario: 部署工作流资源预检（deploy.yml preflight，09-05 起）

### 1. Scope / Trigger

- Trigger：基础设施接线（D1 / Queue / Secrets 注入 `wrangler.toml`）。`.github/workflows/deploy.yml` 在部署前按名预检/创建 Cloudflare 资源，D1 id 运行时解析。改动 `wrangler.toml.example` 的 `database_name` 或 `queue` 名字、或新增需要预建的绑定类型时，必须同步本节。
- 来源：任务 `09-05-deploy-auto-provision`（research：`wrangler-provisioning.md`）。

### 2. Signatures

- 步骤：`Ensure Cloudflare resources (D1 + Queue)`，`id: ensure_resources`，位于 `Fetch Account ID` 之后、`Generate wrangler.toml from template` 之前。
- 使用的 wrangler 命令（4.x，均为账号级、无需配置文件）：
  - `wrangler d1 list --json` → `[{uuid, name, ...}]`（内部分页拉全）
  - `wrangler d1 create <name>`（同名已存在会报错，**必须先查再建**）
  - `wrangler queues info <name>`（不存在 → 非零退出；`queues list` **无 `--json`**，不要用它做脚本解析）
  - `wrangler queues create <name>`（同名已存在会报错）
- Step output：`d1_id`（D1 uuid），供 sed 替换 `__D1_DATABASE_ID__`。

### 3. Contracts

- Secrets：`WORKER_NAME`、`CF_API_TOKEN` 必填；`CF_D1_DATABASE_ID` **可选覆盖**；`CF_ACCOUNT_ID`、`CUSTOM_DOMAIN` 可选。
- Token 权限：Workers 编辑模板 + **D1 Edit** + **Queues Edit**（创建资源必需）。
- Step env：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`WRANGLER_HIDE_BANNER="true"`、`WRANGLER_SEND_METRICS="false"`、`D1_NAME=vn-shelf-db`、`QUEUE_NAME=vn-index-queue`、`PROVIDED_D1_ID=${{ secrets.CF_D1_DATABASE_ID }}`。
- `D1_NAME` / `QUEUE_NAME` 与 `wrangler.toml.example` 的 `database_name` / `queue` **同值约定**，改一处必改另一处。
- 不回写 GitHub Secrets（Action 无写权限）；id 每次运行按名解析。
- 日志：`::add-mask::$D1_ID` 必须在写 `$GITHUB_OUTPUT` 之前；只打印末 4 位。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| `PROVIDED_D1_ID` 有值且 uuid 存在于账号 | 复用，不创建 |
| `PROVIDED_D1_ID` 有值但 uuid 不存在 | `::error::` 退出 1，不创建任何资源 |
| 无 `PROVIDED_D1_ID`，`vn-shelf-db` 存在 | 复用其 uuid |
| 无 `PROVIDED_D1_ID`，`vn-shelf-db` 缺失 | `::warning::`（明示 NEW EMPTY database）→ `d1 create` → 再查拿 uuid；仍取不到 → `::error::` 退出 1 |
| `queues info` 成功 | 复用 |
| `queues info` 失败 | 打印其 stderr → `queues create`；create 失败原样冒泡（`set -euo pipefail`），不吞鉴权/权限错误 |

### 5. Good/Base/Bad Cases

- Good：新增需要预建的资源（如 KV）→ 同一步骤内加「查 → 缺则建」分支，名字放 env 并与模板同值；输出走 `$GITHUB_OUTPUT`。
- Base：Durable Object（`[[migrations]]`）与 Assets 部署时自动创建，**不要**加预检。
- Bad：依赖 `wrangler deploy` 自动建 Queue（源码硬报错 `Queue "x" does not exist`）；用 `wrangler deploy --x-provision`（隐藏 experimental，且不含 Queue）；直接 `create` 靠报错判存在；按 `database_name` 校验用户提供的 id（用户既有库可能不叫 `vn-shelf-db`）。

### 6. Tests Required

- 无真实账号的 stub 模拟（fake `npx` + fake `jq` 置于 PATH，`GITHUB_OUTPUT` 指向临时文件），覆盖矩阵四路径并断言：调用序列（是否出现 `d1 create` / `queues create`）、退出码、`::warning::`/`::error::`/`::add-mask::` 出现与否、`GITHUB_OUTPUT` 内容。
- `node -e "require('js-yaml').load(...)"` 校验 YAML + 抽取 `run` 块 `bash -n`。
- 步骤顺序断言：`Fetch Account ID < Ensure Cloudflare resources < Generate wrangler.toml`。

### 7. Wrong vs Correct

```bash
# Wrong：banner 走 stdout 会污染 JSON；靠 create 报错判存在
DB_ID=$(npx wrangler d1 list --json | jq -r '.[0].uuid')      # 未设 WRANGLER_HIDE_BANNER，且取第一个而非按名
npx wrangler queues create vn-index-queue || true              # 吞掉了权限错误

# Correct：显式关 banner；按名查、缺则建；失败冒泡
export WRANGLER_HIDE_BANNER=true
D1_ID=$(npx wrangler d1 list --json | jq -r --arg n "$D1_NAME" '.[] | select(.name == $n) | .uuid' | head -n1)
[[ -n "$D1_ID" ]] || { npx wrangler d1 create "$D1_NAME"; D1_ID=$(...再查一次); }
npx wrangler queues info "$QUEUE_NAME" >/dev/null 2>/tmp/q.err || { cat /tmp/q.err; npx wrangler queues create "$QUEUE_NAME"; }
```

> **Warning**：wrangler 版本 banner 经 `console.log` 写 **stdout**（实测无 `--json` 时 84 bytes）。任何在脚本中解析 wrangler `--json` 输出的地方，都要显式设 `WRANGLER_HIDE_BANNER=true`，不要依赖 `--json` 的隐式抑制。

---

## Scenario: 登录限流（LoginRateLimiter，09-12 起）

### 1. Scope / Trigger

- Trigger：改动 `POST /api/auth/login` 鉴权流程、`src/login-ratelimit.js`、`LoginRateLimiterDurableObject`，或新增任何「DO 状态机 + 纯函数判定」类功能时参照。
- 来源：任务 `09-12-security-hardening-bundle`。

### 2. Signatures

```js
// src/login-ratelimit.js（纯函数，node --test 直测）
LOGIN_MAX_FAILURES = 5; LOGIN_LOCK_MS = 600_000; LOGIN_WINDOW_MS = 900_000
evaluateLoginAttempt(state, { now, success })
// state = { failures, windowStart, lockUntil }（均可 null）
//   → { allowed, failures, windowStart, lockUntil, retryAfterSec }

// src/index.js LoginRateLimiterDurableObject（每 IP 一实例：env.LOGIN_RATE_LOCK.idFromName(ip)）
GET  /precheck            → { allowed, retryAfterSec }（只读，不推进状态）
POST /record  { success } → 推进状态机并持久化（storage 键 'login:rate-state'，无 alarm 惰性过期）
```

### 3. Contracts

- handleLogin 插入顺序：password 非空校验 → precheck（锁定即 429 + `Retry-After` 秒头，**先于 getSettings / PBKDF2**）→ getSettings → Turnstile 校验（09-19 起插入，双钥匙门内，见「登录 Turnstile 校验」Scenario；Turnstile 拒绝不进本限流计数）→ verifyAdminPassword → **同步 `await record`**（非 waitUntil——保证第 5 次失败后的下一次请求立即被锁）→ 签发 JWT。
- IP 来源 `CF-Connecting-IP`，缺失（本地 dev）回退占位键 `'local'`。
- **fail-open 降级**：`env.LOGIN_RATE_LOCK` 绑定缺失或 DO 请求失败 → `console.warn` + 放行。与 `INDEX_START_LOCK` 的 fail-closed（缺失 500）**语义相反且有理由**：索引锁守护数据正确性（宁可拒绝服务），限流锁守护的是可用性增强（漏配绑定不应弄挂登录）。
- 新增 DO 类必须追加**新 migration tag**（本次 `tag = "v2"` + `new_sqlite_classes`），既有 tag 不可变；DO 部署期自动创建，deploy.yml 不加预检（见部署 Scenario Base case）。
- 锁定语义：15 分钟窗口内连续 5 次失败 → 锁 10 分钟；锁内无论密码对错一律 429 且状态不变；成功登录清零；**锁到期但窗口未过期时再失败立即重锁**（窗口 15min > 锁 10min 的自然推论，已钉测试）；第 5 次 record 返回 `allowed: false` 但**该次响应仍是 401**——429 从第 6 次开始。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| precheck 锁定中 | 429 + `Retry-After`（秒），不执行 getSettings / PBKDF2 |
| 第 5 次密码错误 | 该次 401；状态写入 `lockUntil` |
| 锁定期内正确密码 | 429（文案不泄露密码对错） |
| 锁到期 + 正确密码 | 200 且计数清零 |
| 绑定缺失 / DO 异常 | warn + 放行（fail-open，`npm run tail` 可见 `[auth][login-ratelimit] binding missing`） |

### 5. Good/Base/Bad Cases

- Good：新增同类「计数 + 锁定」功能时复用三层结构：**纯函数状态机（直测）+ DO 只做存储协议 + 路由层薄接线**。
- Base：不动登录流程无需理会本契约。
- Bad（禁止）：把判定逻辑写进 DO 壳或 router 内联（不可直测、桩复刻必假绿）；record 走 waitUntil（第 5 次失败后的并发请求存在未锁窗口）。

### 6. Tests Required

- `tests/auth/login-ratelimit.test.mjs`：纯函数全分支——锁内 success/failure 状态不变、窗口过期重开、到期即窗口内再锁、`retryAfterSec` 取整、成功清零。
- `tests/router/login.ratelimit.test.mjs`：DO 桩**内嵌真实 `evaluateLoginAttempt`**（只复刻 `/precheck` `/record` 协议与 storage 写回语义），断言 429 形态 + Retry-After、锁内 `verifyAdminPassword` 与 `getSettings` 调用数为 0、成功清零、到期解锁。
- `tests/queue/index.queue.test.mjs`：加载 `src/index.js` 的 patch 列表已含 `login-ratelimit` 真实源文件（依赖图陷阱，见信封 Scenario §6）。

### 7. Wrong vs Correct

```js
// Wrong：测试桩自己复刻判定逻辑（实现变更时假绿）
const stubDo = { async fetch() { return json({ allowed: attempts >= 5 }); } }; // 自造阈值语义

// Correct：桩 import 真实纯函数，只复刻协议层
import { evaluateLoginAttempt } from './login-ratelimit.real.mjs';
const stubDo = { async fetch(req) { /* storage 读写 + 委托 evaluateLoginAttempt */ } };
```

---

## Convention: JWT 校验契约（09-12 收紧后）

**What**：`verifyJWT` 固定 HMAC-SHA256 验签**之后**强校验 header `alg === 'HS256'`（拒绝 none / HS384 / 缺失——防未来算法混淆回归）与 `exp`（必须有限数值且 `exp > now`；缺失 / 非法 / `exp <= now` 即拒）。`createJWT` 是唯一签发方（恒 HS256 + `exp = iat + 24h` + jti），收紧不破坏存量登录态。

**Why**：收紧前 `payload.exp &&` 短路使无 exp 的 token 永不过期；alg 不校验虽因固定 HMAC 当前不可利用，但属纵深防御缺口（2026-09-12 侦察确认）。

**Tests**：`tests/auth/jwt.test.mjs` 直测（不经 router 桩替换）：alg 伪造三态、缺 / 非数值 exp、`exp == now` 与 `now-1` 边界、篡改 payload / 签名、setAuthCookie（Secure 双形态）属性串、setAdminPassword ↔ verifyAdminPassword 往返。node ≥ 18 原生 WebCrypto / btoa / atob，无 polyfill（`tests/auth/` 为新纯后端直测域，先例 `tests/vndb/`）。

**Related**：本任务同时新增 `tests/auth/` 目录；`constantTimeEqual` 保持未导出，经 `verifyPassword` / `verifyJWT` 行为断言覆盖。

---

## Scenario: 公开读端点缓存与版本键失效（09-12 起）

### 1. Scope / Trigger

- Trigger：改动 `src/http-cache.js`、公开 GET 端点的缓存/ETag 行为、写路由的版本 bump 接入、或新增公开只读端点时的缓存集合变更。
- 来源：任务 `09-12-public-cache-and-index`。设计动因：**Workers Cache API 只能按精确 URL 删除、无通配 purge**，而 `/api/vn` 有 sort×search×untiered 不可枚举的查询串变体——故采用版本键设计，把 purge 变成"换钥匙"。

### 2. Signatures

```js
// src/http-cache.js
readCacheVersion(env)   // settings PK 点查，缺失 = 0；读前 initDB 复用 WeakSet 记忆化
bumpCacheVersion(env)   // 单语句原子自增：INSERT ... ON CONFLICT(key) DO UPDATE SET value = value + 1
buildEtag(version)      // `"vshelf-N"`（四个端点共用同一版本号）
servePublicCached(request, env, ctx, path, handler, cachesImpl = globalThis.caches)
                        // cachesImpl 参数注入是可测性契约，测试传桩断言 match/put

// src/router.js
PUBLIC_CACHE_PATH_PATTERNS          // 4 端点：/api/vn、/api/vn/v\d+、/api/stats、/api/tier（appearance 除外：前端恒 no-store 直查，无需版本键机制）
invalidatePublicCacheAfterWrite(h)  // 写路由出口统一包裹：仅 2xx 才 ctx.waitUntil(bump)，bump 失败仅告警
```

### 3. Contracts

- **缓存键 = `request.url + '__cv=' + version`（合成查询串）**：写后版本自增 → 旧键自然失联永不命中，60s TTL 兜底回收孤儿副本。缓存键天然含原查询串，变体不串味。
- **访客路径**（无 `auth_token` Cookie）：200 响应附 ETag + `Cache-Control: public, max-age=60` 并 `cache.put` 合成键副本；`If-None-Match` 命中返回 304（空体，保留 ETag/Cache-Control）；**仅 200 落副本**——404 等带 ETag + max-age（浏览器 ≤60s 陈旧上界可接受）但不 put（Workers `cache.put` 对非 200 受限）。
- **管理员三不原则**（Cookie 含 `auth_token` 即可，**不校验有效性**——判定缓存身份与 authMiddleware 鉴权职责分层）：**永不 match / 永不 put / 永不 304**，响应 `no-store` + ETag。Why：bump 走 `ctx.waitUntil` 有毫秒级窗口，写后立即带旧 ETag 回读时若允许 304 会命中陈旧数据——这正是 PRD 明令禁止的写后回读陈旧回归。
- **ETag 全端点共用单一版本号**：跨端点误失效（改 tier 名使 vn 列表 ETag 变）成本 = 一次重算，换零 body 哈希、零 purge 复杂度，显式接受。
- **`cache:version` 是 settings 表第 4 命名空间**（schema_version / config:settings / tier:list:meta / cache:version），必须独立读写——**禁止挂进 config:settings blob**（否则与管理员保存配置互相踩版本语义 + 读放大）。
- **命中副本必须重建**：`new Response(cached.body, cached)`——Cache API 返回的 Response headers 不可变，外层 CORS 统一 `set` 需要可变头。CORS 附加保持 `handleRequest` 出口统一（304 / 命中 / 404 三路径全覆盖）。
- **写路径 bump 接入**（12 处，漏一处 = 对应端点访客最长 60s 陈旧）：10 个写路由经 `invalidatePublicCacheAfterWrite` 分发层包裹（vn 三写含 refreshVNDB 分支、tier 归属两写、tier CRUD 四写、import）；queue 消费批级 `vnDataWritten` 标记 + 同步 bump 一次/批（不走 waitUntil，避免破坏既有 queue 测试计数语义）；ulist 导入 `imported > 0` 才 bump（纯 skipped 不 bump）。`PUT /api/config` 不 bump（不写 vn/tier 数据）。
- **前端 D3**：管理员态的列表/统计/Tier/详情 GET 传 `cache: 'no-store'`（vnShelf.loadVNList、tierlistPage.loadTiers/loadVNList、statsPage.loadStats、shared.openDetail）——消除"登录前 60s 访客态副本被复用"的浏览器缓存登录切换窗口。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| 访客 INM 等于当前版本 ETag | 304 空体（ETag + Cache-Control 保留，CORS 由外层附加） |
| 访客 INM 为旧版本 | 200 全量（旧缓存键失联，不误命中） |
| 写路由 2xx | `ctx.waitUntil(bump)`，版本 +1，新旧 ETag 切换 |
| 写路由 4xx（校验失败） | 不 bump |
| bump 落库抛错 | `console.warn`，写响应不受影响 |
| 带 auth_token Cookie（任意值） | 200 直查 + `no-store`，INM 也不 304 |
| appearance 端点 | 响应头仍 `max-age=300`、无 ETag（服务端零变化）；前端契约恒 `no-store` 直查（2026-09-19），头仅服务外部 API 消费者。ETag 不适用于冷启动收紧：max-age 窗口内浏览器不发再验证请求，bump/换 ETag 无法推送失效仍新鲜的浏览器副本 |

### 5. Good/Base/Bad Cases

- Good：新增公开只读端点 → 加入 `PUBLIC_CACHE_PATH_PATTERNS` + http-cache 测试补端点覆盖。
- Base：不公开/写端点无需理会；`PUT /api/config` 类不写 vn/tier 的端点不接 bump。
- Bad（禁止）：handler 内自加 Cache-Control（破坏出口统一）；`cache:version` 挂进 config blob；读改写三步自增版本（并发竞态）；允许管理员 304；给非 200 响应 `cache.put`。

### 6. Tests Required

- `tests/router/http-cache.test.mjs`：真实 router + http-cache + db 链路，caches 经第 6 参注入桩——访客 miss/ETag/CORS/合成键、二次命中 handler 零执行、查询串变体不串味、管理员三不原则、304 空体三头、写后版本自增旧键失联、4xx 不 bump + bump 抛错不破写响应、appearance 不入缓存。
- **patch 桩同步纪律**：router.js 新增 `./http-cache.js` import 时，八个 copy 型 router 桩（envelope / config.update / vndb.search / vn.status / index.start / import.appearance / login.ratelimit / http-cache——**含本 Scenario 自己测试文件的加载器**；09-19 修正：原记七个漏了 http-cache.test.mjs 自身，login-turnstile 任务实际同步 8 个）+ queue 加载器 + ulist 桩必须全员同步直通/计数桩（依赖图陷阱，见信封 Scenario §6）。
- `tests/d1/migrations.test.mjs`：v3（idx_vn_entries_created）存量库应用用例；EXPLAIN QUERY PLAN 走索引（无 TEMP B-TREE）。

### 7. Wrong vs Correct

```js
// Wrong：读改写自增版本（两请求并发读到同值，丢一次 bump → 访客多 60s 陈旧）
const v = Number(await readCacheVersion(env));
await saveCacheVersion(env, v + 1);

// Correct：单语句原子自增，败者不丢更新
await env.DB.prepare(
  "INSERT INTO settings (key, value) VALUES ('cache:version', '1') " +
  "ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)"
).run();
```

```js
// Wrong：管理员也走 304（bump 异步窗口内写后回读命中陈旧 304）
if (request.headers.get('If-None-Match') === etag) return notModified();

// Correct：三不原则——Cookie 在即直查 + no-store
if (hasAuthCookie) {
  const res = await handler();
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
```

---

## Scenario: 外观字段扩展契约（以 ownerName 为例，09-15）

### 1. Scope / Trigger

- Trigger：向外观管线（settings blob → `GET /api/config/appearance` / `GET+PUT /api/config` / 导出导入）新增一个**非敏感展示型文本字段**时的七处贯通与校验契约。
- 先例字段：`backgroundUrl` / `backgroundOverlay` / `backgroundBlur` / `ownerName`。

### 2. Signatures

```js
// settings blob（config:settings JSON，无 schema 迁移）
ownerName: string   // trim 后 ≤ 30 字符；'' = 未设置（前端回退品牌名「VN Shelf」）

// 七处贯通点（漏一处即字段半残）：
// repository.js: getSettings 默认值 / applyAppearanceToSettings（防御 trim+slice）/ exportData appearance
// router.js:     handleGetAppearance / handleGetConfig / handleUpdateConfig / handleImport 校验段
```

### 3. Contracts

- 公开侧 `GET /api/config/appearance` 与管理侧 `GET /api/config` 均返回（未配置输出 `''`）；字段属公开可读外观数据，与背景同级。
- **校验风格分野**：展示型文本字段用**显式 400**（非 string / trim 后超长），不做静默 coerce——与 import 校验对齐；数值型外观字段（overlay/blur）保留 clamp 静默风格。空串合法 = 清除设置。
- **跨字段校验前置不变量**（09-15-config-put-validate-first 确立）：`handleUpdateConfig` 的全部 400 校验必须在任何持久化（`setAdminPassword` 直写凭据 / `saveSettings`）之前执行——任一字段校验失败时，密码哈希、jwtSecret 与 settings blob 均零变更。新增会 400 的字段时加进前置校验段，不得在赋值段内联 return 400（赋值段应无 return，直落到 `saveSettings`）。
- `null` 归一不对称：PUT 拒绝 `null`（400），import 将 `null → ''`——与 backgroundUrl 先例一致。
- 导入缺省（旧备份无该字段）跳过不动，行为向后兼容。
- 前端写入仅 `textContent` / `document.title`（无 HTML sink），后端 trim + 限长兜底。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| PUT `ownerName` 非 string | 400 `ownerName 必须为字符串`，不落库 |
| PUT `ownerName` trim 后 > 30 | 400 `ownerName 长度不能超过 30`，不落库 |
| PUT `ownerName` 空串/纯空白 | 合法，落库 `''`（清除个性化） |
| PUT 混合请求：合法 `newPassword` + 非法 `ownerName`（或反序） | 400（前置校验任一失败），`setAdminPassword` / `saveSettings` 零调用，凭据与配置零变更 |
| import `appearance.ownerName` 非法 | 400（与 PUT 同规则），不触达 importData |
| import `appearance.ownerName === null` | 归一 `''` 后应用 |
| import 无 `ownerName` 键 | 跳过，存量值不动 |

### 5. Good/Base/Bad Cases

- Good：新外观字段按七处清单贯通 + 两端测试（router 校验矩阵 + repository 读写）同步落地。
- Base：字段未配置时全链路输出与既有行为逐字节一致（空串走回退分支）。
- Bad：只加 GET 不加 PUT 校验；展示文本走数值 clamp 静默风格；字段写入 innerHTML。

### 6. Tests Required

- `tests/router/config.update.test.mjs`：PUT 合法（trim/边界 30/空串清除）+ 400 两态且断言不落库 + 两个 GET 返回字段（含未配置 `''`）+ 未认证 401 不落库。
- 混合请求零持久化断言：400 路径断言 `setAdminPasswordCalls.length === 0` **且** `saveSettingsCalls.length === 0`（`setAdminPassword` 不走 `saveSettings`，两个桩都要计数）；成功路径断言 `createJWTCalls[0].secret === setAdminPasswordCalls[0].jwtSecret`（token 基于轮换后密钥签发）。
- `tests/router/import.appearance.test.mjs`：import 校验矩阵（400 不触达 importData / null 归一 / 缺省跳过）。
- `tests/d1/repository.test.mjs`：importData 写 settings（防御截断）+ exportData 携带字段。

### 7. Wrong vs Correct

```js
// Wrong ①：展示型文本静默 coerce（超长悄悄截断，用户以为存上了全名）
if (body.ownerName !== undefined) settings.ownerName = String(body.ownerName).slice(0, 30);

// Wrong ②：校验留在赋值段，而更早的分支已持久化（半提交：响应 400，但密码已改、旧 token 已失效）
if (body.newPassword) {
  await setAdminPassword(env, body.newPassword);   // ← 先落库轮换 jwtSecret
}
// ...中间若干字段...
if (body.ownerName !== undefined && typeof body.ownerName !== 'string') {
  return errorResponse('ownerName 必须为字符串', 400);  // ← 迟到的 400
}

// Correct：全部 400 校验前置到任何 await 写入之前；校验与赋值共用同一 trim 变量，不留缝隙
if (body.newPassword && body.newPassword.length < 6) return errorResponse('密码长度至少6位', 400);
let ownerName;
if (body.ownerName !== undefined) {
  if (typeof body.ownerName !== 'string') return errorResponse('ownerName 必须为字符串', 400);
  ownerName = body.ownerName.trim();
  if (ownerName.length > 30) return errorResponse('ownerName 长度不能超过 30', 400);
}
// ——校验全部通过，以下才允许持久化；赋值段无 return，直落 saveSettings——
if (body.newPassword) await setAdminPassword(env, body.newPassword);
if (body.ownerName !== undefined) settings.ownerName = ownerName;
```

---

## Scenario: 登录 Turnstile 校验（09-19 起）

### 1. Scope / Trigger

- Trigger：改动 `POST /api/auth/login` 校验链、`src/turnstile.js`、`POST /api/config/turnstile/test`、settings 两键（`turnstileSiteKey` / `turnstileSecretKey`）或登录页 widget 装载逻辑的变更。
- 来源：任务 `09-19-login-turnstile`。与登录限流（09-12）组成纵深：限流卡频率、Turnstile 卡自动化。**未配置（两键任一空）时全链路与现状逐字节一致**——零感知升级是前提，不是可选项。

### 2. Signatures

```js
// src/turnstile.js（网络胶水：永不抛出、无 import 依赖、fetchImpl/timeoutMs 注入直测）
verifyTurnstileToken({ secretKey, token, remoteIp, fetchImpl = fetch, timeoutMs = 10_000 })
// → { outcome: 'pass' | 'invalid' | 'error', errorCodes?: string[] }
//   'invalid' 含 token 非法形态（非 string / > 2048）——不发网络请求
//   'error' = throw / 非 2xx / 坏 JSON / 超时（AbortSignal.timeout）——降级方向由调用方决定

// settings blob 新键（config:settings，无 schema 迁移；导出/导入不携带，对齐 vndbApiToken）
turnstileSiteKey: string    // 公开级：/api/auth/status 双门输出 + GET /api/config 明文
turnstileSecretKey: string  // 敏感：仅服务端持有；GET /api/config 只回 hasTurnstileSecret 布尔

// 新端点（认证，不入 CORS 公开集合）
POST /api/config/turnstile/test { siteKey, secretKey, token } → data { ok: true } | { ok: false, errorCodes } | 503
```

### 3. Contracts

- **handleLogin 插入顺序**（09-12 契约扩展）：password 非空校验 → 限流 precheck（429 先于一切）→ getSettings → 双钥匙门（`siteKey && secretKey` 均非空才校验）→ verifyAdminPassword → record → JWT。
- **双钥匙门是全局不变量**：登录启用条件与 `/api/auth/status` 的 `turnstileSiteKey` 输出门同构——「widget 可见 ⟺ 后端强制校验」。半配（仅 siteKey）时 status 必须输出 `''`，否则前端会索要一个后端并不校验的 token（09-19 check 阶段抓获的 P2，已修）。
- **Turnstile 拒绝不计限流**：400（缺 token）/ 403（invalid）两分支在 `verifyAdminPassword` 与 `recordLoginResult` 之前 return——限流计数 = 密码尝试次数；Turnstile 拒绝时密码未校验、PBKDF2 未消耗。
- **fail 语义分野（同一次 siteverify、两种降级方向）**：登录侧 outcome `'error'` → `console.warn('[auth][turnstile] …')` + 放行（fail-open 守可用性，对齐 LOGIN_RATE_LOCK）；测试端点 `'error'` → 503（fail-closed 守真实性——fail-open 会让误配拿假绿，废掉该端点的存在意义）。
- 测试端点用**请求体输入值**而非已存 settings 值打 siteverify——支撑设置页「先测试后保存」，消除误配锁死（本功能最大风险；最终退路 = `wrangler d1 execute` 清两键恢复登录）。
- remoteip 传真实 `CF-Connecting-IP`，头缺失不传（不是限流的 `'local'` 占位——那是 DO 实例键，不是 IP）。
- 前端契约（细节见 frontend quality-guidelines「Turnstile 懒加载例外」）：脚本仅 siteKey 非空时经 `public/js/turnstile.js` 懒加载单例注入；token 单次消费 → 每次登录尝试后 `turnstile.reset()`；theme 按站点主题显式传（auto 跟系统不跟手动主题）。
- **遥测信标快速应答**（09-19 turnstile-local-ux）：`/cdn-cgi/challenge-platform/*` 前缀的 OPTIONS/POST 在 `handleRequest` 早段快速 204 + 定向 CORS（ACAO 仅 `https://challenges.cloudflare.com`，OPTIONS 反射 `Access-Control-Request-Headers`）；其他方法维持自然 404。Why：Turnstile 在遥测定型前不派发 token，本地 wrangler dev 无 CF 边缘时信标落到 Worker 404 无 CORS 头 → 预检失败+重试序列拖慢 token 派发（真 key 才有完整遥测流，dummy keys 测不出）。生产该路径被 CF 边缘吸收、处理器不可达（双保险无害）。响应构造导出为纯函数 `challengePlatformBeaconResponse(method, requestHeaders)` 直测，**不新增 import**（零桩同步成本）。
- **登录按钮门控**：Turnstile 已启用且 token 未签发期间按钮 `aria-disabled="true"` 置灰（09-09 契约：禁原生 disabled——Chrome 夺焦点），**保留**提交时「请完成人机验证」校验兜底（token 过期竞态点击仍有反馈）。未配置时行为与现状一致。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 两键任一空（未配置 / 半配） | 跳过校验，行为与现状一致；status 输出 `''` |
| 已启用 + 无 turnstileToken | 400「请完成人机验证」，不 record、不跑 PBKDF2 |
| 已启用 + siteverify invalid | 403「人机验证失败，请重试」，不 record（errorCodes 仅进 warn 日志，不回前端） |
| 已启用 + siteverify pass | 到密码层，后续与现状一致 |
| siteverify 异常（登录侧） | warn + 放行（fail-open） |
| siteverify 异常（测试端点） | 503「人机验证服务暂时不可用，请稍后重试」 |
| PUT 两键非 string / trim > 200 | 400，且任何持久化零调用（09-15 前置校验不变量） |
| PUT 空串 | 合法 = 清除该键 |
| 测试端点缺参 / token > 2048 | 400 |
| 测试端点 siteverify invalid | **200** + `{ ok: false, errorCodes }`（测试失败是有效结果，非协议错误） |

### 5. Good/Base/Bad Cases

- Good：同类「外部服务校验」功能复用本形态：永不抛出的胶水模块（outcome 三态）+ fail 语义按守护对象选择（可用性 fail-open / 真实性 fail-closed）+ 配置类功能提供「用输入值试运行」端点。
- Base：不配置两键 = 什么都不发生。
- Bad（禁止）：status 输出走单门（`siteKey || ''`）；Turnstile 拒绝路径调 record（污染密码尝试计数）；测试端点 fail-open；脚本写死进 html 或无条件加载。

### 6. Tests Required

- `tests/auth/turnstile.test.mjs`：outcome 三态 + token 非法形态零网络调用 + form body 三字段 / remoteip 省略 + 超时。
- `tests/router/login.turnstile.test.mjs`：未配置 / 半配放行、400 / 403 双零断言（verifyAdminPassword 桩 + 限流 DO storage）、pass 全通、fail-open、429 先于 siteverify、**半配 status 输出 `''`**。
- `tests/router/config.turnstile.test.mjs`：401 / 缺参 400 / **输入值与已存值分离断言**（STORED-*/INPUT-* 双桩）/ ok 三态。
- `tests/router/config.update.test.mjs`：两键校验矩阵 + 混合请求零持久化双计数。
- `tests/router/challenge-platform.test.mjs`（09-19 turnstile-local-ux）：信标纯函数方法矩阵 + `handleRequest` 早段接线（信封路径不触碰 env，可空 env 直调）。
- 桩纪律：router.js 的 `./turnstile.js` import → 八个 copy 型 router 桩全员同步（见 http-cache Scenario §6 的 09-19 修正）。

### 7. Wrong vs Correct

```js
// Wrong：status 单门输出（半配时前端索要一个后端不校验的 token）
turnstileSiteKey: settings.turnstileSiteKey || ''

// Correct：双门同构——widget 可见 ⟺ 后端强制校验
turnstileSiteKey: settings.turnstileSiteKey && settings.turnstileSecretKey
  ? settings.turnstileSiteKey
  : ''
```

```js
// Wrong：测试端点 fail-open（误配拿假绿，防锁死机制失效）
if (outcome === 'error') return successResponse({ ok: true });

// Correct：登录 fail-open 守可用性、测试端点 fail-closed 守真实性
if (outcome === 'error') return errorResponse('人机验证服务暂时不可用，请稍后重试', 503);
```
