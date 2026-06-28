# PRD — B2 前端缓存与重复消除

> 上下文：`docs/frontend-improvements.md` 批次 B2（T2-A2 / T2-P1 / T2-P2 / T2-P3 / T2-A4）。
> 设计落 `implement.md`；本 PRD 只列要求与验收。

## 背景

B1 完成后，前端供应链与小 bug 已清。B2 聚焦 MPA 模型下的**重复请求**与**重复样板**：每页都拉一次 `/api/config/appearance`、搜索无防抖、IndexedDB 连接不复用、translations 后台检查无节流、settings 四处 `save*` 同构代码。这些不构成功能缺陷，但放大冷启动成本与维护漂移。

## 目标（5 个独立可验证交付物）

### 1. appearance 全局缓存（T2-A2）
- 现状：`theme.js:96 initBackground` 与 `shared.js:42 loadConfig` 每页各发一次 `GET /api/config/appearance`。
- 目标：`Alpine.store('app')` 增 `appearance` 字段 + `loadAppearance()`，带 **Promise 去重**（同次首屏并发只发一次）+ **sessionStorage 直读**（跨页冷启动先读缓存再后台刷新）。`theme.js` 与 `shared.js` 改从 Store 读取，不再各自直接请求。

### 2. 搜索 debounce（T2-P1）
- 现状：`vnShelf.js:79 handleSearch` + `index.html:100 @input` 每键全表过滤。
- 目标：`public/js/utils.js` 新增 `debounce(fn, ms=200)`；`handleSearch` 改为防抖版本。过滤结果不变。

### 3. translations version.json 节流（T2-P2）
- 现状：`translations.js:259 checkForUpdatesInBackground` 每次 `initTranslations`（每页访问）都拉 version.json。
- 目标：`localStorage` 存 `lastVersionCheckAt`，**24h 内跳过**远端检查；超时再后台比对。返回缓存语义不变。

### 4. IndexedDB 连接缓存（T2-P3）
- 现状：`translations.js:31 openTranslationsDB` 每次调用都 `open` 新连接。
- 目标：模块级缓存 `let _db`，命中直接 resolve；监听 `onclose`/`onversionchange` 清理缓存以便重建。

### 5. settings `withLoading` 抽象（T2-A4）
- 现状：`settingsPage.js` 的 `saveVndbToken`(123) / `changePassword`(139) / `saveTagsConfig`(289) / `saveAppearanceConfig`(334) 四处 `isLoading=true / try-catch / addToast / finally isLoading=false` 同构。
- 目标：抽 `withLoading(async fn, { successMsg, errorPrefix })` 高阶包装（可放 `utils.js` 或组件内 helper），四处改为单行调用。行为不变（含 success msg、error toast 文案、`isLoading` 翻转、`finally` 复位）。

## 范围外

- 后端接口信封统一（`res.data || res` 兜底，A3）——后端项，本批不动。
- 错误 toast 友好化（S4，B4）。
- a11y、壳层抽离（B3）。
- 不改任何后端代码、不改 API 路由。

## 约束

- **无构建步骤**；仅改 `public/js/`。
- **保持行为不变**：appearance 渲染、背景、tags 翻译、搜索结果、settings 保存反馈与原先一致。
- **不引入新第三方库**。
- `sessionStorage`/`localStorage` 键加版本前缀防冲突（如 `vn-shelf:appearance:v1`）。
- 遵循 B1 已沉淀的 spec（`.trellis/spec/frontend/quality-guidelines.md`）：默认 header 保留、禁用 runtime CDN、禁 `Date.now()` id。

## 验收标准

| # | 条件 | 验证方式 |
|---|------|---------|
| AC1 | 单页内 `/api/config/appearance` 至多 1 次请求 | DevTools Network：首次进首页仅 1 条 |
| AC2 | 同首屏并发（theme + tagsView 同时取）只发 1 次 | 代码审查 Promise 去重 + Network 确认 |
| AC3 | 跨页切换命中 sessionStorage 直读，后台静默刷新而非阻塞 | Network：第二页无 appearance 请求或仅后台静默 |
| AC4 | `debounce` 存在且 `handleSearch` 被其包裹 | 代码审查；快速连按 5 字仅触发一次过滤（可 console.log 计数验证） |
| AC5 | 24h 内重复进站，`version.json` 不被请求 | localStorage `lastVersionCheckAt` 存在；Network 无 version.json（除非超 24h） |
| AC6 | 多次 translations 读取只触发一次 IDB `onsuccess` | 代码审查 `_db` 缓存 + 行为验证 |
| AC7 | `withLoading` 抽象存在且四处 save 改造完成 | `grep -n "isLoading = true" public/js/components/settingsPage.js` 命中数显著下降（理想为 0，除极少数特殊流程） |
| AC8 | settings 四处保存行为不变（成功 toast、失败 toast、loading 翻转） | 手动冒烟各 Tab 保存 |
| AC9 | `npm run lint` 通过 | 退出 0 |
| AC10 | `npm run test` 通过 | 退出 0 |
| AC11 | 本地 `npm run dev` 五页面正常渲染（首页搜索/排序、设置各 Tab、背景、tags 翻译、Tier、统计） | 手动冒烟 |

## 风险与回滚

- **风险**：Store 缓存引入跨页脏数据（appearance 改了但未刷新前未见） → `sessionStorage` 在 settings 保存后主动失效键 + `loadAppearance` 提供 `force` 参数。
- **风险**：debounce 导致搜索"延迟感" → 200ms 是常规值，必要时降到 150ms。
- **风险**：`_db` 缓存在连接异常时持有失效句柄 → `onclose` 清理 + 下次自动重建。
- **回滚**：5 交付物按文件分提交，任一回归单独 revert。

## 设计要点（详见 implement.md）

- `Store.app.appearance` 增 `loadAppearance({force=false})`：先尝试 sessionStorage → 兜底请求 → 写回 Store + sessionStorage。Promise 去重用 `_appearancePromise`。
- `theme.initBackground` / `shared.loadConfig` 改为 `const cfg = await this.$store.app.loadAppearance(); this.config = ExtractTagsFields(cfg)`。
- `debounce`：经典 trailing 实现，`utils.js` 导出。
- translations 节流：`checkForUpdatesInBackground` 入口先查 `localStorage['vn-shelf:trans:versionCheckAt']`，未超 24h 直接 return。
- `openTranslationsDB`：`if (_db) return Promise.resolve(_db)`；`request.onsuccess` 缓存 `_db = request.result` 并挂 `onclose`/`onversionchange` 清理。
- `withLoading`：放 `utils.js`，签名 `(ctx, asyncFn, { successMsg, errorPrefix })`，`ctx` 提供 `this.isLoading` 与 `this.$store.app.addToast` 绑定。