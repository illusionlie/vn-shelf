# 技术设计

## 1. 边界与影响面

| 区域 | 文件 | 变更性质 |
|------|------|----------|
| Worker 配置 | `wrangler.toml`, `.dev.vars`(新), `package.json` | 配置修正 |
| 后端 | `src/router.js`, `src/auth.js`, `src/index.js`, `src/index-task.js`, `src/db.js` | 减法 + 行为变更（CORS/Cookie/appearance）+ 重构 |
| 前端 | `public/js/markdown.js`, `public/js/translations.js`, `public/js/components/{vnShelf,tierlistPage}.js`, 共享模块(新), `public/js/api.js` | 减法 + 重构 + 热刷新功能 |
| 静态资源 | `public/success.html`(删) | 减法 |
| 文档 | `CLAUDE.md`, `AGENTS.md` | 同步 |
| 测试 | `tests/**` | 按新行为调整，必要时补充 |

不动：`src/repository.js` 的索引 reconcile、`src/vndb.js` 的 `searchVN`、queue 消费逻辑。

## 2. 关键设计决策

### 2.1 Cookie Secure（R2.1）

- `setAuthCookie(response, token, secure)` 签名不变；两处调用点（`router.js` login 与 updateConfig）改为 `env.ENVIRONMENT !== 'development'`。
- `wrangler.toml [vars] ENVIRONMENT = "production"`；新增 `.dev.vars` 内容仅 `ENVIRONMENT=development`。`wrangler dev` 自动读取 `.dev.vars` 覆盖 `[vars]`。
- `.dev.vars` 不含任何秘密，**纳入版本控制**（若 `.gitignore` 已排除则显式调整），否则其他环境克隆后本地 dev 会拿到 production 行为。
- 失败兜底：即使 `.dev.vars` 缺失导致本地也发 Secure Cookie，现代浏览器对 `http://localhost` 按可信源处理，登录仍可用，仅属体验降级。

### 2.2 CORS（R3）

- 删除现有全局 OPTIONS 块（router.js:72-83）。
- 新增公开路由判定 `isPublicCorsRequest(path, method)`：精确匹配五个 GET 端点（`/api/vn`、`/api/vn/v\d+`、`/api/stats`、`/api/tier`、`/api/config/appearance`）。
- 命中时：GET 响应统一追加 `Access-Control-Allow-Origin: *`（在 handler 返回后由 `handleAPI` 出口处包一层，避免逐 handler 修改）；OPTIONS 请求返回 204 + `Allow-Origin: *` + `Allow-Methods: GET, OPTIONS` + `Max-Age`。
- 非公开路径的 OPTIONS 返回 404/405，不带 CORS 头。
- 注意 `handleGetAppearance` 已自带 `Cache-Control`，追加头使用 `headers.set`，互不冲突。

### 2.3 公开 tags 配置（R4）

- `handleGetAppearance` 响应 data 增加 `tagsMode`、`translateTags`、`translationUrl`（取值逻辑与 `handleGetConfig` 相同的默认值规则）。
- 前端 `vnShelf` / `tierlistPage` 的 `loadConfig` 改调 `configAPI.getAppearance()`；`settingsPage` 继续用认证版 `/api/config`（它还需要 hasVndbApiToken 等字段），不动。
- 兼容性：响应为增量字段，对现有调用方（theme.js 的 initBackground 只读三个背景字段）无影响。

### 2.4 getSettings 请求级去重（R7.2）

不引入跨请求缓存（Workers 的 `env` 对象跨请求复用，按 env 做 memo 会造成多 isolate 间的旧密钥/旧密码窗口）。改为**沿调用链复用**：

- `authMiddleware` 已经加载 settings → 返回值增加 `settings` 字段：`{ authenticated, user?, error?, settings }`。
- 需要 settings 的认证 handler（`handleGetConfig`、`handleUpdateConfig`、`handleInit` 不适用、`handleLogin` 单独处理）优先用 `auth.settings`。
- `handleLogin`：先 `getSettings` 一次，用导出的 `verifyPassword` 直接校验 `settings.adminPasswordHash`，再用同一 settings 的 `jwtSecret` 签发——由 2 次查询降为 1 次。`verifyAdminPassword(env, password)` 保留给 `auth.js` 内部/其他调用方或改为接受 settings 参数（实施时取改动最小者）。
- `fetchVNDB` 内部的 `getSettings`（queue 消费场景无 auth 上下文）保持不变。

### 2.5 translations-updated 热刷新 + 前端共享模块（R5/R6.1）

新建 `public/js/components/shared.js`（或 `public/js/tagsView.js`，实施时按现有 import 风格定夺），导出两个 factory：

```js
createTagsView()    // 返回 { config, translations, loadConfig, initTranslations,
                    //        getDisplayTags, setupTranslationsRefresh } 供组件展开
createDetailModal() // 返回 { selectedVN, showDetail, openDetail, closeDetail }
```

- `loadConfig` 内部走公开端点（2.3），不再有 401 回退分支。
- `setupTranslationsRefresh(componentRef)`：`window.addEventListener('translations-updated', ...)` → 从 IndexedDB 重读翻译（`getFromIndexedDB`）并赋值 `componentRef.translations`，Alpine 响应式触发模板里 `getDisplayTags` 重新求值。MPA 无需 teardown；组件 `_initialized` 守卫防止重复挂监听。
- `vnShelf` 与 `tierlistPage` 以对象展开方式混入，删除各自重复实现；`tierlistPage.getDetailTags` 与 `vnShelf.getDisplayTags` 逻辑相同，统一为 `getDisplayTags`（HTML 模板中 `getDetailTags` 调用点同步改名）。

### 2.6 router tier 校验提取（R6.2）

提取 `normalizeTierAssignmentInput(raw)`：输入 `{ tierId, tierSort }` 原始值，返回 `{ tierId, tierSort }` 或抛带 message 的校验错误；`handleUpdateVNTier` 与 `handleBatchUpdateVNTier` 复用。错误文案保持与现有完全一致（有测试断言文案的风险点）。

### 2.7 initDB batch 化（R7.1）

```js
await db.batch(SCHEMA_SQL.map(sql => db.prepare(sql)));
```

- `db.exec` 的多行限制不适用于 `prepare`，SCHEMA_SQL 已是单行语句，逐条 prepare 安全。
- 风险点：`tests/d1` 的 D1 测试桩若只实现了 `exec` 而其 `batch` 不支持 DDL 语句，需同步调整测试桩。`initDB` 入口的 `typeof db.exec !== 'function'` 守卫同步改为校验 `prepare`/`batch`。

### 2.8 markdown.js 减法（R1.4）

- 删除 `stripMarkdown`、`getMarkdownExcerpt`、`renderMarkdown` 的 options 参数及末尾两段 replace 过滤。
- `renderMarkdown(text)` 变为单参数；现有调用方（vnShelf/tierlistPage 直接挂载）零改动。
- `tests/public/markdown.security.test.mjs` 已确认未引用被删项。

### 2.9 排序本地化与搜索一致性（R7.3/R7.4）

- `handleSortChange`：本地实现与后端 `handleGetVNList` 相同的比较器（created→`createdAt` ISO 串比较、personal→`personalRating`、默认→`rating`；asc/desc），排序 `vnList` 后重放当前搜索过滤得到 `filteredList`。
- `handleSearch` 增加 `titleJa` 匹配（列表项已含该字段）。

## 3. 数据流与兼容性

- 无 schema 变更、无存储迁移；导入/导出格式不变。
- API 兼容性：`/api/config/appearance` 增量字段（向后兼容）；全局 OPTIONS 预检移除（同源前端从不发预检，无影响）；其余端点契约不变。
- 行为变更仅三处：Cookie Secure 条件反转、公开端点 CORS 头、appearance 响应字段——均已获用户确认。

## 4. 测试与回滚

- 基线：lint 0 错误、58 测试全绿（2026-06-12 实测）。
- 预期需调整：CORS 相关（若现有 router 测试覆盖 OPTIONS）、appearance 响应断言（config.update.test.mjs 若有覆盖）、D1 测试桩 batch DDL 支持。
- 建议补充：appearance 公开字段断言、`isPublicCorsRequest` 端点矩阵小测试。
- 回滚：纯代码 + 配置变更，`git revert` 即可整体回退；无数据回滚需求。`.dev.vars` 删除不影响线上。

## 5. 提交切分

1. `chore`: 死代码/死配置清理（R1 全部 + success.html）
2. `fix`: Cookie Secure + deploy 脚本 + 文档同步（R2）
3. `feat`: CORS 改造 + 公开 tags 配置 + 前端共享模块/热刷新（R3/R4/R5/R6.1）
4. `refactor/perf`: tier 校验提取 + initDB batch + settings 去重 + 前端搜索/排序（R6.2/R7）

每步提交前 lint + test 全绿，保证任意中间点可回滚。
