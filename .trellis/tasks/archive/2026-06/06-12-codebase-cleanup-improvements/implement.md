# 执行计划

按 4 个提交批次推进，每批次结束跑 `npm run lint && npm test`，全绿后提交（提交需用户在 Phase 3 确认）。任意批次失败可独立回滚，不影响已完成批次。

## 批次 1：死代码与死配置清理（R1）

- [ ] 1.1 `wrangler.toml`：删除 `[[kv_namespaces]]` 段与底部注释掉的 production KV 配置；删除 `[vars]` 中 `BACKGROUND`
- [ ] 1.2 `src/index-task.js`：删除 `isIndexTaskTerminalStatus`、`mergeIndexTaskFailedIds`；保留并导出 `INDEX_TASK_ACTIVE_STATUSES` / `INDEX_TASK_TERMINAL_STATUSES`，`src/index.js` 改为 import（删除其本地 `INDEX_ACTIVE_STATUSES`/`INDEX_TERMINAL_STATUSES` 定义，index.js:15-16）
- [ ] 1.3 `public/js/markdown.js`：删除 `stripMarkdown`/`getMarkdownExcerpt`；`renderMarkdown` 去掉 `options` 参数与 `disableImages`/`disableLinks` 过滤段
- [ ] 1.4 删除 `public/success.html`
- [ ] 1.5 验证：
  ```bash
  npm run lint && npm test
  # 零引用确认（应无任何匹配）：
  grep -rn "env.KV\|BACKGROUND\|stripMarkdown\|getMarkdownExcerpt\|disableImages\|disableLinks\|mergeIndexTaskFailedIds\|isIndexTaskTerminalStatus" src/ public/ tests/
  ```
- [ ] 1.6 回滚点：提交批次 1

## 批次 2：修复（R2）

- [ ] 2.1 `src/router.js`：两处 `env.ENVIRONMENT === 'production'`（login ~285、updateConfig ~1207）改为 `env.ENVIRONMENT !== 'development'`
- [ ] 2.2 `wrangler.toml`：`[vars] ENVIRONMENT` 改为 `"production"`
- [ ] 2.3 新增 `.dev.vars`（内容：`ENVIRONMENT=development`）；检查 `.gitignore`，确保该文件被纳入版本控制
- [ ] 2.4 `package.json`：deploy 脚本改为 `npm ci && wrangler deploy`
- [ ] 2.5 更新 `CLAUDE.md`：架构树移除 kv.js/migrate.js、修正 tests 目录、开发注意事项第 5 条"迁移前存储于 KV"等遗留表述
- [ ] 2.6 检查并更新 `AGENTS.md` 中同类过时引用
- [ ] 2.7 验证：`npm run lint && npm test`；`wrangler dev` 启动后登录，确认 Set-Cookie 无 `Secure`（development 生效）
- [ ] 2.8 回滚点：提交批次 2

## 批次 3：CORS + 公开 tags 配置 + 前端共享模块/热刷新（R3/R4/R5/R6.1）

- [ ] 3.1 `src/router.js`：删除全局 OPTIONS 块（72-83）；新增 `isPublicCorsRequest(path, method)` 与出口处 CORS 头追加；公开五端点的 OPTIONS 预检返回 204
- [ ] 3.2 `src/router.js` `handleGetAppearance`：响应增加 `tagsMode`/`translateTags`/`translationUrl`（默认值规则与 `handleGetConfig` 一致）
- [ ] 3.3 新建前端共享模块（`createTagsView` + `createDetailModal`，含 `translations-updated` 监听与 IndexedDB 重读逻辑）
- [ ] 3.4 `vnShelf.js` / `tierlistPage.js`：混入共享模块，删除重复的 `loadConfig`/`initTranslations`/`getDisplayTags`/`getDetailTags`/`openDetail`/`closeDetail`；`loadConfig` 改走 `configAPI.getAppearance()`；同步修改 HTML 模板中 `getDetailTags` 调用点
- [ ] 3.5 测试调整/补充：appearance 响应字段断言；CORS 端点矩阵（公开端点带 `Access-Control-Allow-Origin: *`、认证端点不带）
- [ ] 3.6 验证：
  ```bash
  npm run lint && npm test
  ```
  浏览器实测（`wrangler dev`）：
  - 匿名打开主页/Tier 页：Network 无 401；tags 显示与管理员配置一致
  - `curl -s -D - http://localhost:8787/api/config/appearance` 含三个新字段与 CORS 头
  - 认证端点（如 `/api/config`）响应无 CORS 头
- [ ] 3.7 回滚点：提交批次 3

## 批次 4：重构与小优化（R6.2/R7）

- [ ] 4.1 `src/router.js`：提取 tierId/tierSort 校验 helper，`handleUpdateVNTier` 与 `handleBatchUpdateVNTier` 复用；错误文案逐字保持不变
- [ ] 4.2 `src/db.js`：`initDB` 改 `db.batch(SCHEMA_SQL.map(s => db.prepare(s)))`；入口守卫改校验 `prepare`/`batch`；如 D1 测试桩不支持则同步调整测试桩
- [ ] 4.3 `src/auth.js`/`src/router.js`：`authMiddleware` 返回值附带 `settings`；`handleGetConfig`/`handleUpdateConfig` 复用；`handleLogin` 重构为单次 `getSettings`
- [ ] 4.4 `vnShelf.js`：`handleSearch` 补 `titleJa`；`handleSortChange` 本地排序（比较器语义与后端一致）并重放搜索过滤
- [ ] 4.5 验证：
  ```bash
  npm run lint && npm test
  ```
  浏览器实测：排序切换无网络请求且顺序正确（三种字段 × 升降序抽查）；日文标题可搜索；登录/改密/登出全流程正常
- [ ] 4.6 回滚点：提交批次 4

## 收尾（Phase 3）

- [ ] 5.1 对照 prd.md Acceptance Criteria 逐项核验
- [ ] 5.2 评估是否需要 `trellis-update-spec`（如 CORS 策略、公开端点约定值得沉淀为 spec）
- [ ] 5.3 用户确认后提交、归档任务

## 审查门

- 批次 3 是行为变更核心（CORS/公开端点/前端结构），完成后向用户展示实测结果再进入批次 4。
- 任何测试文案断言冲突：以保持对外行为/文案不变为先，仅在确属新行为时改断言。
