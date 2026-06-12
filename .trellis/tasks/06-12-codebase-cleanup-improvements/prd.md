# 代码库清理与改进：死代码移除、安全修复与公开配置端点

## Goal

一次性完成代码库审阅（2026-06-12）确认的清理、修复与改进项：移除已验证零引用的死代码与死配置，修复生产 Cookie 缺 Secure 标志等实际问题，并让匿名访客获得与管理员一致的 tags 显示配置。所有决策已与用户逐项确认。

## Requirements

### R1 死代码与死配置清理

- R1.1 `wrangler.toml`：删除 KV namespace 绑定（`binding = "KV"`）及底部注释掉的 production KV 配置段。
- R1.2 `wrangler.toml`：删除 `[vars]` 中的 `BACKGROUND` 变量。
- R1.3 `src/index-task.js`：删除未被任何代码与测试引用的 `isIndexTaskTerminalStatus`、`mergeIndexTaskFailedIds`、`INDEX_TASK_TERMINAL_STATUSES`；索引状态集合（active/terminal）在 `src/index.js:15-16` 与 `src/index-task.js:8-9` 重复定义，统一为一处（index-task.js 导出，index.js 引用）。
- R1.4 `public/js/markdown.js`：删除 `stripMarkdown`、`getMarkdownExcerpt` 及 `renderMarkdown` 的 `disableImages`/`disableLinks` 选项机制（调用方与测试均未使用）。
- R1.5 删除 `public/success.html`。
- R1.6 **明确保留**：`src/vndb.js` 的 `searchVN()`（用户要求备用）；`public/cover.webp`（README.md:4 引用）。

### R2 实际问题修复

- R2.1 生产 Cookie Secure 标志（双修）：
  - 代码：Secure 默认开启，仅 `env.ENVIRONMENT === 'development'` 时豁免（当前 `src/router.js:285,1207` 为 `=== 'production'` 才开启）。
  - 配置：`wrangler.toml` `[vars]` 的 `ENVIRONMENT` 改为 `production`；新增 `.dev.vars`（`ENVIRONMENT=development`）供 `wrangler dev` 本地覆盖。
- R2.2 `package.json` deploy 脚本：`npm i & wrangler deploy` 改为 `npm ci && wrangler deploy`。
- R2.3 文档同步：更新 `CLAUDE.md` 与 `AGENTS.md` 中过时的架构描述（移除 kv.js/migrate.js 引用、修正 tests 目录结构）。

### R3 CORS 改造

- R3.1 删除 `src/router.js:72-83` 的全局假 CORS 预检（OPTIONS 返回 `Allow-Origin: *` 但实际响应从不带 CORS 头）。
- R3.2 仅为公开只读端点提供真实 CORS（响应带 `Access-Control-Allow-Origin: *`，并处理对应 OPTIONS 预检）：`GET /api/vn`、`GET /api/vn/:id`、`GET /api/stats`、`GET /api/tier`、`GET /api/config/appearance`。
- R3.3 认证类与写操作端点不提供 CORS 头（Cookie SameSite=Strict，跨域认证本不可行）。

### R4 公开 tags 配置

- R4.1 `GET /api/config/appearance` 响应并入 `tagsMode`、`translateTags`、`translationUrl` 三个字段（非敏感）。
- R4.2 前端 `vnShelf.js` 与 `tierlistPage.js` 的 `loadConfig` 改用公开端点，消除匿名访客每次页面加载的 401 回退；访客与管理员看到一致的 tags 显示。
- R4.3 已知权衡：该端点带 `Cache-Control: public, max-age=300`，配置变更最多延迟 5 分钟对访客生效（已与用户确认可接受）。

### R5 translations-updated 热刷新

- R5.1 `public/js/translations.js` 后台更新缓存后 dispatch 的 `translations-updated` 事件当前无监听器；在使用翻译的页面组件中添加监听器，事件触发后重新加载翻译数据并刷新 tags 显示，无需用户手动刷新页面。

### R6 重复逻辑提取（纯重构，行为不变）

- R6.1 前端：`vnShelf.js` 与 `tierlistPage.js` 重复的 `loadConfig`/`initTranslations`/`getDisplayTags`(≡`getDetailTags`) 等逻辑提取到共享模块，并作为 R5 监听器的统一挂载点。
- R6.2 后端：`src/router.js` 中 `handleUpdateVNTier` 与 `handleBatchUpdateVNTier` 重复的 tierId/tierSort 规范化校验提取为 helper。

### R7 小优化

- R7.1 `src/db.js` `initDB`：10 条串行 `db.exec` 改为一次 `db.batch(SCHEMA_SQL.map(s => db.prepare(s)))`，降低冷启动首请求延迟。
- R7.2 `getSettings` 请求级缓存：单请求内 authMiddleware 与 handler 重复查询 settings（2-3 次相同 D1 查询）合并为一次。
- R7.3 `src/router.js` `handleGetVNList` 搜索过滤已含 titleJa；前端 `vnShelf.js` `handleSearch` 本地过滤补齐 titleJa 匹配，保持前后端一致。
- R7.4 前端 `vnShelf.js` `handleSortChange`：排序切换改为本地排序，不再重新请求列表。

### 范围外（已确认不做）

- 索引 reconcile 机制（`src/index.js` queue handler 与 `max_batch_size=1` 的关系）保持现状。
- 登录速率限制不在本任务范围。

## Acceptance Criteria

- [ ] `npm run lint` 0 错误；`npm test` 58 个测试基线全部通过（CORS/markdown 相关测试按新行为调整后全绿，不允许删测试凑数）。
- [ ] 全代码库 grep 验证：`env.KV`、`BACKGROUND`、`stripMarkdown`、`getMarkdownExcerpt`、`disableImages`、`disableLinks`、`mergeIndexTaskFailedIds`、`isIndexTaskTerminalStatus` 零引用；`success.html` 不存在。
- [ ] 索引状态集合（active/terminal）全库仅一处定义。
- [ ] `wrangler dev` 本地验证：登录 Set-Cookie 无 Secure（development）；代码审查确认部署态（ENVIRONMENT=production 或未设置）Set-Cookie 含 Secure。
- [ ] 匿名（无 Cookie）请求 `GET /api/config/appearance` 返回 appearance + tags 三字段；主页/Tier 页加载过程 Network 面板无 401 请求。
- [ ] 公开五端点 GET 响应含 `Access-Control-Allow-Origin: *` 且 OPTIONS 预检可用；任一认证端点响应不含 CORS 头。
- [ ] 浏览器实测：主页与 Tier 页 tags 显示正常（含翻译）；排序切换不发起网络请求且顺序正确；搜索可匹配日文标题。
- [ ] CLAUDE.md / AGENTS.md 架构描述与实际文件树一致。

## Notes

- 决策来源：2026-06-12 会话中用户对一/二/三类问题的逐项选择。
- 行为变更点集中在 R2.1（Cookie）、R3（CORS）、R4（公开端点响应结构），其余为纯减法或等价重构。
