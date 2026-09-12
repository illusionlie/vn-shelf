# 公开端点缓存与 created_at 索引

## Goal

为公开只读端点（`/api/vn`、`/api/vn/{id}`、`/api/stats`、`/api/tier`）提供访客缓存命中路径，减少重复 D1 查询与响应流量；修正书架默认排序字段无索引的全表扫描。约束：响应体结构、CORS 行为、管理员写后实时回读三项不回退。

## Confirmed Facts（仓库已验证）

- 四个公开 GET 无任何 Cache-Control / ETag（全库 grep 零命中；唯一例外 `/api/config/appearance` 设 `public, max-age=300`，src/router.js:1245），每次请求直查 D1（src/repository.js:314-340）。
- 管理员写后立即回读：书架增删改/刷新后 `loadVNList()` 全量重载（public/js/components/vnShelf.js:134-146）、Tier 保存后重拉列表——**管理员路径吃到缓存 = 写后回读陈旧，属功能性回归**，必须绕过。
- `getVNList` 默认 `ORDER BY created_at DESC`（src/repository.js:317-319）无对应索引；db.js 现有索引 4 个；D1 schema 迁移有版本连续性契约（tests/d1/migrations.test.mjs 基线回放 + 乱序/跳号校验）。
- 公开 GET 的 CORS 头为响应后置附加 `Allow-Origin: *`（src/router.js:112-114），缓存路径必须保留该行为。
- 写入口集中：`/api/vn` 全套写、`/api/vn/{id}/tier`、`/api/vn/tier/batch`、`/api/tier` 写、`/api/import`、索引与 ulist 任务的终态写。
- Workers 手动 Cache API（`caches.default`）按 URL 编程存取与 purge；Cloudflare 默认不缓存 `/api/*`，需显式写入。

## User Decisions

| 决策 | 结论 |
|------|------|
| 访客缓存陈旧度 | **ETag + 访客 60s 边缘缓存**：无 Cookie 访客命中缓存（写操作经版本号失效），管理员带 Cookie 永远直查并收 no-store（2026-09-12 确认） |

## Requirements

### R1 ETag 协商缓存

- 四个公开 GET 计算 ETag（响应体 SHA-256 派生）并在 200 响应携带；`If-None-Match` 命中返回 304（保留 ETag 与 Cache-Control，空体）。
- ETag 计算不改变响应体与 CORS 附加行为。

### R2 访客缓存路径（陈旧度待决策）

- 无 `auth_token` Cookie 的请求：响应加 `Cache-Control: public, max-age=<TTL>`，并经 Cache API 按 URL 缓存副本；同 URL 再访直接命中（含 ETag 头）。
- 带 `auth_token` Cookie 的请求：绕过缓存读写，响应 `Cache-Control: no-store`，永远直查 D1（保证管理员写后回读实时）。
- 缓存键含查询串（`sort` / `search` / `untiered` 不同参数不串味）。

### R3 写失效

- 改变 vn / tier 数据的写操作成功后，经 `ctx.waitUntil` purge 相关缓存键（`/api/vn`、受影响的 `/api/vn/{id}`、`/api/stats`、`/api/tier`）。
- purge 失败不影响写响应（仅记日志）；TTL 作为失效兜底。

### R4 created_at 索引

- 新增 D1 migration：`CREATE INDEX idx_vn_entries_created ON vn_entries(created_at DESC)`；版本号递增，迁移测试基线同步更新。
- 不改变 `status` 无索引的既有决策（src/db.js:41 注释：列表全量加载后前端筛选）。

## Acceptance Criteria

- [ ] AC1 同一公开 GET 第二次携带 If-None-Match 且数据未变 → 304，响应含相同 ETag。
- [ ] AC2 无 Cookie 访客二次请求命中 Cache API 副本（测试注入 mock caches 断言 match/put）；带 Cookie 请求永不读缓存且响应为 no-store。
- [ ] AC3 任一写操作成功后对应缓存键被 delete；purge 抛错不影响写响应。
- [ ] AC4 CORS 附加行为在缓存命中路径不回退（`Allow-Origin: *` 仍在）。
- [ ] AC5 migration 后列表排序查询走 idx_vn_entries_created（EXPLAIN QUERY PLAN 或等价断言）；迁移测试全绿。
- [ ] AC6 `npm run lint`、`npm test` 通过。

## Out of Scope

- KV / R2 / Analytics Engine 引入。
- `/api/vndb/search` 上游结果缓存、HTML 静态资源缓存策略。
- stats 物化表、列表分页 API。
- 通用 CDN「Cache Everything」页面规则。

## Open Questions

- 无。技术方案见 `design.md`，执行计划见 `implement.md`。
