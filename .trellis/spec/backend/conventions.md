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
