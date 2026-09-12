# 执行计划：公开端点缓存与 created_at 索引

按 D1（索引）→ D2（版本机制 + 缓存）→ D3（前端防陈旧）顺序，两个 commit 粒度。全局验证：`npm run lint && npm test`。

## 前置核实（动手前）

- [ ] 核实 apiRequest（public/js/api.js）对 304 的实际行为：浏览器 fetch 会自动把 304 合并缓存副本返回 200——本地 `npm run dev` 下用 DevTools Network 与 curl（curl 需手动带 If-None-Match）各验证一次，确认前端路径无需改动
- [ ] 确认 queue() 上下文里可用的 bump 时机（batch 处理完 / 终态判定处），选定单一插入点

## D1 created_at 索引（独立 commit，先行）

- [ ] `src/db.js` MIGRATIONS 追加 v3（单行 SQL，见 design.md）
- [ ] 更新 `tests/d1/migrations.test.mjs`：期望版本数 + 基线回放断言
- [ ] 验证：`npm test`（迁移域全绿）
- [ ] 本地 dev 首请求触发迁移后，`wrangler d1 execute`（或测试内 EXPLAIN QUERY PLAN 断言，二选一）确认 `getVNList` 查询走 `idx_vn_entries_created`

**回滚点：D1 commit 独立（迁移只向前，回滚 = 旧版 Worker 部署，索引无害）。**

## D2 版本机制 + 缓存

- [ ] 新建 `src/http-cache.js`：`readCacheVersion(env)`、`bumpCacheVersion(env)`（design.md 的单语句原子自增 SQL）、`buildEtag(version)`、`servePublicCached(request, env, ctx, path, handler, cachesImpl = globalThis.caches)`
- [ ] `src/router.js` `handleRequest`（108-117）：公开 GET 且命中缓存路径集合时改走 `servePublicCached` 包裹 `handleAPI`；CORS 后置附加逻辑（112-114）保持在外层不动
- [ ] 写 handler 接入 `ctx.waitUntil(bumpCacheVersion(env))`：design.md「写路径接入」清单逐项（vn 三写、tier 两写、tier CRUD 四写、import、queue/ulist 落库）
- [ ] `servePublicCached` 内 `await initDB(env.DB)` 后再读版本（首请求建表时序）
- [ ] router 测试（桩注入 cachesImpl）：
  - 访客二次请求命中缓存副本（断言 match/put 调用与返回的缓存响应）
  - 带 `auth_token` Cookie：永不 match、响应 `no-store`、handler 直行
  - If-None-Match 命中 → 304（ETag/Cache-Control 保留）
  - 写成功后版本自增（断言 bump SQL 执行 / 新请求缓存键版本变化）
  - CORS 头在缓存命中与 304 路径仍被附加
- [ ] 验证：`npm run lint && npm test`
- [ ] 本地 dev 手测：无痕窗口访客两次刷新（第二次 Network 面板确认边缘/浏览器命中或 304）；登录后编辑条目 → 列表立即反映（管理员直查）

**回滚点：D2 commit 独立（去掉包裹即回到直查行为；settings 里的 cache:version 残留行无害）。**

## D3 管理员端浏览器防陈旧

- [ ] `public/js/api.js` `apiRequest` 支持 `opts.cache` 透传
- [ ] vnShelf / tierlistPage / statsPage 的 GET 调用点（loadVNList、tier 列表加载、stats 加载，约 4 处）：`$store.app.isAdmin` 时传 `{ cache: 'no-store' }`
- [ ] 验证：`npm run lint && npm test`；手测登录态切换窗口（访客浏览 → 登录 → 立即编辑 → 列表即时反映）

**回滚点：D3 随 D2 commit 或独立，前端纯增量。**

## 收尾检查（对应 AC）

- [ ] AC1 304 行为（curl 实测记录）
- [ ] AC2 访客命中 / 管理员绕过（测试 + Network 面板截图或文字记录）
- [ ] AC3 写后版本失效（测试断言）
- [ ] AC4 CORS 不回退（测试断言）
- [ ] AC5 索引生效（EXPLAIN 记录）
- [ ] AC6 lint + test 全绿

## 风险文件

`src/router.js`（handleRequest 结构调整 + 11 处写 handler 插 bump，回归靠既有 router 测试全量）、`src/index.js`（queue 写路径 bump 插入点，勿动既有重试/幂等语义）。
