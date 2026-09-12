# 侦察事实：公开端点缓存与 created_at 索引（2026-09-12）

实现前必读的代码形态与约束。需求级事实见 prd.md Confirmed Facts。

## 路由与 CORS 结构（src/router.js:90-121）

```
handleRequest(request, env, ctx)
  ├─ OPTIONS + isPublicCorsPath → 204 预检
  ├─ /api/* → response = await handleAPI(...)
  │    └─ GET + isPublicCorsPath → response.headers.set('Access-Control-Allow-Origin', '*')  ← 112-114，对返回值后置附加
  └─ 其余 → 404
```

- 缓存包裹点：`handleAPI` 调用外（109 行处）。CORS 附加在外层对**任何**返回的 response 做 `set`——缓存命中/304 路径同样被覆盖，无需在缓存层重复处理。
- `PUBLIC_CORS_PATH_PATTERNS`（48-54）：`/api/vn`、`/api/vn/v\d+`、`/api/stats`、`/api/tier`、`/api/config/appearance`。缓存集合 = 前 4 项。

## 响应构造（src/utils.js:55-57 successResponse）

`successResponse(data, message?, meta?)` 构造 JSON Response；handlers 均经它返回——servePublicCached 只需对返回的 Response 做 `headers.set` / `clone()` / `cache.put`，不碰 body 构造。

## settings 表读写模式（src/repository.js:281-310）

- 现有三命名空间：`schema_version`（db.js:36）、`config:settings`（配置 blob）、`tier:list:meta`。
- `getSettings/saveSettings` 操作的是 `config:settings` 单键——**版本键必须独立读写**（新 repository 函数或 http-cache.js 内联 SQL），不能挂进 config blob（否则与管理员保存配置互相踩版本语义，且读放大）。
- D1 点查形态先例：`db.prepare('SELECT value FROM settings WHERE key = ?').bind(...).first()`（db.js:55）。

## D1 迁移契约（src/db.js 头注 1-21 + MIGRATIONS 39-50）

- MIGRATIONS 版本从 1 连续递增（现到 v2）；单条 migration 的 statements + 版本号写入同一 `db.batch` 原子提交；并发竞争由「败者重读版本号」容忍。
- **单行 SQL 强制**（db.exec 多行历史坑，见头注 16-20）。
- 索引列现状：`idx_vn_entries_tier(tier_id)`、`idx_vn_entries_updated(updated_at)`（db.js:30-31）——created_at 是唯一缺位。
- `ORDER BY created_at DESC` 在 `getVNList`（src/repository.js:317-319）；`status` 无索引是有意决策（db.js:41 注释），不要顺手加。

## 前端回读路径（写后必须实时）

- vnShelf 增删改/刷新后 `loadVNList()` 全量重载（vnShelf.js:134-146；09-09 spec Scenario「就地更新」只覆盖单条刷新，其余写仍走全量重载）。
- tierlistPage 保存后重拉列表；statsPage 页面加载拉 `/api/stats`。
- api.js `apiRequest`（api.js:30-70 区间）是全部 `/api` 请求的统一入口——`opts.cache` 透传加在这里即可全站生效。

## Cache API 约束（设计动因）

- `caches.default.match(request)` 按**完整 URL 含查询串**键控：`/api/vn?sort=rating_desc` 与 `/api/vn?sort=created_desc` 是两个条目。
- `cache.delete(url)` 只删精确 URL，**无通配**——sort（6 变体）× search（任意串）× untiered 的组合空间不可枚举 purge，故采用版本键设计（键里带版本，purge = bump 版本换钥匙，孤儿条目交 TTL 回收）。
- `cache.put(request, response)` 要求 response body 未消费——对 handler 返回的 response 先 `clone()` 再 put，原副本返回给客户端。
- ctx.waitUntil 可用性：`handleRequest(request, env, ctx)` 签名有 ctx；queue() 上下文是 `(batch, env, ctx)`，同样有 ctx。

## 304 与前端 fetch 的交互（implement 前置核实项）

- 浏览器 fetch 对同 URL 未过期缓存直接复用（不发条件请求）；过期后发 If-None-Match，收到 304 时**自动**用缓存副本组装备 200 语义返回——`res.json()` 不受影响，api.js 预计零改动（以本地 dev 实测为准）。
- curl / 中间层会看到裸 304：响应需带 ETag + Cache-Control（design.md 已列）。

## 测试技术先例

- router 级：复制源码替换 import（tests/router/envelope.test.mjs:113-121）；env 对象注入桩（DO/绑定先例 index.start.test.mjs:150-178）。`servePublicCached` 已按参数注入 `cachesImpl` 设计，桩可直接传 mock 对象记录 match/put/delete 调用。
- 迁移域：tests/d1/migrations.test.mjs 基线回放 + 版本连续性 + 并发竞争三态——v3 追加后更新期望值。
