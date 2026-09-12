# 技术设计：公开端点缓存与 created_at 索引

## 架构

新增 `src/http-cache.js` 导出 `servePublicCached(request, env, ctx, path, handler)`，在 `handleRequest`（src/router.js:108-117）对公开 GET 分支包裹现有 handler，**不改任何 handler 内部**。

适用路径集合 = `PUBLIC_CORS_PATH_PATTERNS`（src/router.js:48-54）去掉 `/api/config/appearance`（该端点维持现状 `max-age=300`，不引入 ETag/版本机制）。

## 数据版本：缓存失效的核心机制

**问题**：Workers Cache API 只能按精确 URL 删除，无通配 purge——`/api/vn?sort=…` 的查询串变体（6 种 sort × search × untiered）无法逐一失效。

**方案**：版本键设计，把「purge」变成「换钥匙」。

- settings 表新键 `cache:version`（十进制数字字符串，缺失视为 0）
- 写路径成功后自增（单语句原子，避免读改写竞态）：

```sql
INSERT INTO settings (key, value) VALUES ('cache:version', '1')
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
```

- 读取：`SELECT value FROM settings WHERE key = 'cache:version'`（PK 点查，读取前 `await initDB(env.DB)` 复用 WeakSet 记忆化）
- **ETag = `"vshelf-<version>"`**（全端点共用一个版本号）：版本随任何数据写递增 → 「内容变则 ETag 变」天然成立，无需 body 哈希。跨端点误失效（改 tier 名导致 vn 列表 ETag 变）成本 = 一次重算，接受。

## 请求流（servePublicCached）

1. `hasAuthCookie`：Cookie 头含 `auth_token`
2. `version = await readCacheVersion(env)`（一次 PK 点查）
3. `If-None-Match === etag` → 直接 304（带 ETag + Cache-Control；CORS 头由外层 handleRequest:112-114 对返回的 response 统一 `set`，304 同样生效，无需重复处理）
4. `hasAuthCookie` → 执行 handler，响应加 `Cache-Control: no-store` + ETag，返回（**管理员永远直查 D1**，写后回读实时性由此保证）
5. 访客：构造合成缓存键 `new Request(request.url + '__cv=' + version, request)` → `caches.default.match(cacheKey)` 命中 → 直接返回副本；未命中 → 执行 handler → 响应加 ETag + `Cache-Control: public, max-age=60` → `ctx.waitUntil(cache.put(cacheKey, response.clone()))` → 返回
6. 写后：版本已 bump → 旧版本缓存键自然失联（永不命中），60s TTL 兜底回收孤儿条目；**无需 purge、无通配删除难题**

## 写路径接入（bumpCacheVersion）

改变 vn/tier 数据的 handler 成功返回前调用 `ctx.waitUntil(bumpCacheVersion(env))`：

- `POST /api/vn`、`PUT /api/vn/{id}`（含 refreshVNDB 分支）、`DELETE /api/vn/{id}`
- `PUT /api/vn/{id}/tier`、`PUT /api/vn/tier/batch`
- `POST /api/tier`、`PUT /api/tier/order`、`PUT /api/tier/{id}`、`DELETE /api/tier/{id}`
- `POST /api/import`（merge / replace）
- Queue 消费与 ulist 导入的落库写：queue() 无 ctx（有 `batch` 上下文）——在批次汇总/终态判定处同步 bump（或每消息 saveVNEntry 后标记，终态时统一 bump 一次）；ulist-import 的 `ctx.waitUntil` 管线内同理。

竞态说明：bump 经 waitUntil 异步执行，与后续读请求存在毫秒级窗口——访客可能短暂拿到旧版本缓存，但被 60s TTL 陈旧上界覆盖（用户已确认该容忍度）；管理员路径不吃缓存，无影响。

## 管理员端浏览器缓存防陈旧

服务端已对 cookie 请求回 no-store，但**登录前 60s 内以访客态 fetch 过的浏览器 HTTP 缓存副本**可能被复用（HTTP 缓存按 URL 键控、不区分 Cookie 变化），造成管理员写后回读陈旧。

对策：`apiRequest` 支持 `opts.cache`（透传 fetch init）；vnShelf / tierlistPage / statsPage 的列表/统计/Tier GET 调用点（约 4 处）在 `$store.app.isAdmin` 时传 `'no-store'`。访客路径不动（继续吃浏览器与边缘两层缓存）。

## 可测性

`servePublicCached(request, env, ctx, path, handler, cachesImpl = globalThis.caches)`——caches 以参数注入，router 测试传可控桩（match/put/delete 断言），无需全局 mock。

## D1 migration v3（src/db.js MIGRATIONS 追加）

```js
{ version: 3, statements: ['CREATE INDEX IF NOT EXISTS idx_vn_entries_created ON vn_entries(created_at DESC)'] }
```

- 单行 SQL（db.js:16-20 头注约定）；版本连续性由 `sortAndValidateMigrations` 强制，tests/d1/migrations.test.mjs 的基线回放与期望版本数需同步更新
- SQLite 支持 DESC 索引，`getVNList` 的 `ORDER BY created_at DESC`（src/repository.js:317-319）可直接利用
- 回滚遵循「迁移只向前」策略（db.js 头注）：回滚 = 部署旧版 Worker，多余索引无害

## 兼容性

- 响应体、successResponse 信封、CORS 附加行为零变化；304 为新增响应形态（fetch 调用方 api.js 的 `res.json()` 路径——**需核实 apiRequest 对 304 的处理**：304 无 body，`res.json()` 会抛错。处理：apiRequest 收到 304 时按缓存语义回退 `fetch(url, { cache: 'reload' })` 重取，或 GET 请求禁用浏览器条件请求。实测确认 fetch 对同 URL 新鲜缓存会自动复用、根本不发条件请求；只有缓存过期才发 If-None-Match，且 304 时 fetch 自动合并缓存返回 200——**浏览器 fetch API 对 304 自动透明处理**，api.js 无需改动（implement.md 列验证项）。服务端 304 主要服务 CDN/中间层与 curl 类客户端。
- `Cache-Control: public` 允许共享缓存存储：本应用无用户维度的公开 GET 数据（书架是单管理员公开数据），无串号风险。

## 风险与取舍

- 每个公开 GET 增加一次版本 PK 点查：换来命中路径跳过 `getVNList` 全表 SELECT + JS 排序与 `computeStats` 全量聚合，净收益为正
- 单一版本号跨端点误失效：失效成本低（一次重算），换取零 body 哈希与零 purge 复杂度
- `caches.default` 为每数据中心缓存：多 PoP 各自填充，最坏各回源一次；对单管理员低频写场景无感
- 版本键长在 settings 表：与 `schema_version`、`config:settings`、`tier:list:meta` 并存的第 4 个命名空间——单行单键，无 blob 膨胀问题
