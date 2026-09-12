# 执行计划：公开端点缓存与 created_at 索引（已完成 2026-09-12）

按 D1（索引）→ D2（版本机制 + 缓存）→ D3（前端防陈旧）顺序。全局验证：`npm run lint && npm test`。

## 前置核实（结论）

- [x] apiRequest 对 304：浏览器 fetch 规范行为——新鲜期内直接复用副本不发条件请求；过期后自动带 INM，收到 304 时 fetch 自动用本地副本组装 200 语义返回 → **api.js 解析路径零改动**
- [x] queue bump 时机：`queue(batch, env, ctx)` 实际有 ctx（design「queue() 无 ctx」与事实不符）——选定消息循环后、tail reconcile 前的批级 `vnDataWritten` 标记 + **同步 await bump 一次/批**（不走 waitUntil，避免破坏既有 queue 测试计数断言）

## D1 created_at 索引 ✅

- [x] MIGRATIONS v3：`CREATE INDEX IF NOT EXISTS idx_vn_entries_created ON vn_entries(created_at DESC)`（单行 SQL，版本连续 1→3）
- [x] migrations 测试更新 + 新增「存量 v2 库应用 v3」用例
- [x] EXPLAIN QUERY PLAN 实证：`SCAN vn_entries USING INDEX idx_vn_entries_created`，无 USE TEMP B-TREE

## D2 版本机制 + 缓存 ✅

- [x] `src/http-cache.js`：readCacheVersion / bumpCacheVersion（单语句原子自增）/ buildEtag（`"vshelf-N"`）/ servePublicCached（cachesImpl 第 6 参注入）
- [x] `handleRequest` 公开 GET 包裹，CORS 出口附加不动（304/命中/404 三路径覆盖）
- [x] 写路径 12 处 bump：10 写路由经 `invalidatePublicCacheAfterWrite`（2xx 才 bump）+ queue 批级同步 bump + ulist imported>0 bump
- [x] 六个 router patch 桩 + queue + ulist 桩全员同步 http-cache 直通/计数桩（依赖图陷阱无残留）
- [x] `tests/router/http-cache.test.mjs` 10 用例（真实链路 + caches 桩）+ queue/ulist bump 计数用例

## D3 前端防陈旧 ✅

- [x] apiRequest `opts.cache` 透传（`{...options}` 展开 + JSDoc）；vnAPI.getList / vnAPI.get / tierAPI.getList / statsAPI.get 增可选参数
- [x] 管理员 no-store 五处：vnShelf.loadVNList、tierlistPage.loadTiers + loadVNList、statsPage.loadStats、shared.openDetail（第 5 处由 check 阶段补齐——P1 修复）

## 验收核对（AC1-AC6）

- [x] AC1 代码 + 测试 + **curl 实测**（INM 命中 304 空体三头保留）
- [x] AC2 测试断言 match/put + **curl 实测**（任意 auth_token Cookie → no-store 直查不 304）
- [x] AC3 测试断言（版本自增、旧键失联）+ **端到端实测**（见手测记录）
- [x] AC4 测试断言 + curl 实测（304/命中/404 三路径 CORS 均在）
- [x] AC5 EXPLAIN 实证 + 迁移测试全绿
- [x] AC6 lint 零告警、test **248 pass / 0 fail**（基线 235 → +13）

## 手测记录（2026-09-12，wrangler dev @ 127.0.0.1:8787 + Playwright 管理员会话 + curl 访客）

1. **版本轮转端到端（AC3）**：访客 ETag 基线 `"vstack-0"`→管理员 POST /api/vn 创建 v17（Ever17，真实 VNDB 元数据）→ 管理员 no-store 即时回读可见 v17 且 ETag 已轮转 `"vshelf-1"` → 访客 curl 新键 200 含 v17、**旧 ETag INM 得 200（防陈旧生效）**、新 ETag INM 得 304 → DELETE v17 → ETag `"vshelf-2"`、列表复原 154 条。数据零残留。
2. **D3 前端 no-store（页面自身请求）**：管理员登录态下页面加载的 `/api/vn?sort=created_desc` 响应头实测 `cache-control: no-store`（Network 面板级证据，非手造 fetch）。
3. **访客浏览器缓存**：无 Cookie 时响应 `public, max-age=60`；管理员 Cookie 在场即 no-store（Playwright 共享浏览器配置文件发现的意外路径，反而实测了登录态切换场景）。
4. **附带关闭任务 1 遗留项**：管理员 settings 页冒烟通过（8 区块、30 表单控件、Token/导入导出/外观全渲染，零 console 错误）。

## 实现与 design.md 的偏离（已核对，全部合理）

1. 管理员不发 304（design 请求流字面顺序为先查 INM）——PRD R2「永远直查」的直接推论，bump 异步窗口内 304 会返回陈旧数据，测试钉死。
2. bump 接入在 handleAPI 分发层统一包裹而非各 handler 内——契约等价、清单集中可审计。
3. 仅 200 落边缘副本（404 带 ETag/max-age 但不 put）——Workers cache.put 对非 200 受限。
4. 命中副本 `new Response(cached.body, cached)` 重建——Cache API 返回 headers 不可变，外层 CORS set 的前提。
5. queue bump 同步 await（design 自身要求同步，与其「queue 无 ctx」事实描述不符处按代码事实）。

## 遗留人工项

- 生产部署后对生产域名 curl 复核 304 / no-store / CORS 形态（wrangler dev 的 caches.default 是本地模拟，边缘真实命中需线上观察）
- check 阶段 P2 建议（未改）：5xx 也带 `public, max-age=60` 的边界、INM 多值列表/`*` 不命中、tests 目录不在 lint glob——影响极小，后续小任务可收

## 风险文件

`src/router.js`（包裹点 + 10 写路由）、`src/index.js`（queue bump 插入，勿动重试/幂等语义）——回归由 248 用例 + dry-run 覆盖。
