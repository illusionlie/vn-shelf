# implement：appearance 冷路径恒 no-store（方案 c）

> 前置：design.md §5/§6（选定依据与落点）、prd.md（R1-R4 / AC1-AC4）。服务端零变更。

## 执行清单（按序）

### 1. 前端冷路径改 no-store

- [ ] 1.1 [app.js:116](../../../public/js/app.js)：`configAPI.getAppearance(force ? { cache: 'no-store' } : {})` → `configAPI.getAppearance({ cache: 'no-store' })`。
  - 只改 options，不动 `force` 对 `this.appearance` / `this._appearancePromise` 的重置语义（[app.js:91-94](../../../public/js/app.js)）与 Promise dedupe 结构。
  - 同步周边注释：`doLoad` 内 sessionStorage 直读注释与 `loadAppearance` 头注中任何「冷路径走默认缓存」的表述；冷/暖统一后的模型 = 「sessionStorage 只管即时首绘，新鲜度永远来自当次加载的 no-store 源站请求」。
- [ ] 1.2 [api.js:440-447](../../../public/js/api.js)：`getAppearance` doc 注释更新——所有调用路径恒 no-store；`max-age=300` 响应头仅服务外部 API 消费者，前端不再依赖 HTTP 缓存。

### 2. 机制静态测试（AC3 新增）

- [ ] 2.1 新建 `tests/public/appearance-freshness.test.mjs`（静态源分析风格，对齐 `tests/public/i18n.keys.test.mjs`）：
  - app.js 冷路径调用形态：存在 `getAppearance({ cache: 'no-store' })`，且不再存在 `getAppearance(force ?` / 条件化 cache options 残留。
  - 暖路径 intact：sessionStorage 键 `vn-shelf:appearance:v1` 读/写仍在；`_refreshAppearanceBackground` 仍恒 no-store。
  - 失败信息给出修复指引（指向本任务契约）。
- [ ] 2.2 确认服务端断言不动：`tests/router/config.update.test.mjs:622`、`tests/router/http-cache.test.mjs:533,542` 仍为 max-age=300 且通过。

### 3. spec 修订（AC2）

- [ ] 3.1 `.trellis/spec/backend/conventions.md` 公开缓存 Scenario：
  - 校验矩阵行「appearance 端点 | 维持 `max-age=300`、无 ETag（零变化）」→ 更新为：appearance 端点头仍 `max-age=300` 无 ETag，但**前端契约恒 no-store 直查**（09-19），头仅服务外部 API 消费者；附一句 ETag 语义依据（max-age 窗口内浏览器不发再验证，bump 无法推送失效——冷启动收紧不适用 ETag）。
  - :581 `PUBLIC_CACHE_PATH_PATTERNS` 注释行同步（appearance 除外理由从「维持现状」改为「前端恒 no-store，无需版本键机制」）。
  - 不动四端点版本键/ETag 契约本身。
- [ ] 3.2 `.trellis/spec/frontend/state-management.md`：
  - :27-28 契约扩展：sessionStorage read-through 不变；网络路径（冷路径 + force + 后台刷新）**全部**恒 no-store。
  - :52-53 mistakes 条目：09-15 教训从「force/后台刷新须 no-store」延伸为「appearance 的任何网络获取都须 no-store，sessionStorage 是唯一客户端缓存层」。

### 4. 验证与收尾

- [ ] 4.1 `npm run lint && npm run test` 全绿（AC4）。
- [ ] 4.2 AC1 人工复核（不阻塞归档，结果记 journal）：设置 ownerName → 新开无痕标签页 → banner/`<title>` 立即显示新值；可与 owner-name-followups 记忆中的遗留手工复核项（五页生效 / 英文标题 / HTML 字面显示）合并执行。

## 验证命令

```bash
npm run lint
npm run test
```

## 风险文件与回滚点

- 改动面：`public/js/app.js`（1 行 + 注释）、`public/js/api.js`（注释）、新增 1 测试文件、2 个 spec 文件条目。**服务端 src/ 零改动**。
- 风险点：
  - app.js Promise dedupe / force 重置语义被误动 → 1.1 已限定只改 options；测试 2.1 暖路径断言兜底。
  - spec 修订误伤四端点缓存契约 → 3.1 限定只动 appearance 相关行。
- 回滚：revert app.js/api.js + 删除新测试 + revert 两处 spec 条目；无数据/协议迁移，无服务端状态。

## task.py start 前检查

- [ ] implement.jsonl / check.jsonl 已策展（1.3）
- [ ] 最终规划摘要已获用户批准
