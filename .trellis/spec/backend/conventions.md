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
