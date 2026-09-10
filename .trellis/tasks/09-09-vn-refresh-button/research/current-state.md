# 研究：单条目 VNDB 刷新 —— 现状与约束

> 主会话直接侦察（trellis-research 子代理因上游 503 失败，0 次工具调用）。

## 1. 后端：`PUT /api/vn/{id}` 的 `refreshVNDB` 分支

- 处理函数 `handleUpdateVN`（`src/router.js:~640-751`）：
  - `refreshVNDB` 真值 → `entry.vndb = await fetchVNDB(id, env)`（`:691-697`），失败 `errorResponse('VNDB API错误: ' + message, 500)`。
  - 用户字段三态：未出现 = 保持；`tags` 未出现 → `entry.user.tags || []`；`status` 未出现 → `entry.user.status ?? null`。**仅传 `{ refreshVNDB: true }` 时用户字段全部保持**。
  - 返回 `successResponse(savedEntry, '更新成功')` → `{ success, message, data: entry }`，`entry` 形态与 `GET /api/vn/{id}` 一致（`{ id, createdAt, updatedAt, vndb, user }`）。
- `saveVNEntry`（`src/repository.js:353`）→ `buildSaveVNEntryStatement` 使用 **`INSERT OR REPLACE INTO vn_entries`（`:203`）整行写入**。
  - 后果 A：刷新在途时 DELETE 该条目，刷新完成落库会**复活**已删行。
  - 后果 B：刷新在途时另一个 PUT 保存用户字段，先读后写的刷新会用**旧用户数据覆盖**。
  - → 前端必须在同一条目刷新中禁用「编辑」「删除」。
- 列表项投影 `rowToListItem`（`src/repository.js:258-277`）：

  | 列表项字段 | 来源 | 是否随 VNDB 刷新变化 |
  |---|---|---|
  | `title` | `row.title \|\| ''` | ✅ |
  | `titleJa` | `row.title_ja \|\| row.title \|\| ''` | ✅ |
  | `titleCn` | `row.title_cn_user \|\| row.title_cn \|\| ''` | ✅（`vndb.titleCn` 部分；`user.titleCn` 优先） |
  | `image` / `imageNsfw` | vndb | ✅ |
  | `rating` | `toNonNegativeNumber(row.rating)`（非有限/负 → 0） | ✅ |
  | `developers` | JSON 数组 | ✅ |
  | `allAge` | Boolean | ✅ |
  | `personalRating` / `playTimeMinutes` / `tierId` / `tierSort` / `status` / `createdAt` | user / 行元数据 | ❌ 不变 |

  → 前端可用 `{ ...listItem, <上表 ✅ 字段 from entry.vndb / entry.user.titleCn> }` 就地合并，无需重拉列表。

## 2. 前端现状

### 2.1 卡片（`public/index.html:141-185`）
- `div.vn-card[role=button][tabindex=0]` `@click="openDetail(vn)"` `@keydown.enter.space.prevent="openDetail(vn)"`。
- 封面容器 `.vn-card-image-wrapper`（`position: relative; overflow: hidden`，`cards-detail.css:125`），内含：
  - `<img.vn-card-image>`（`aspect-ratio 7/10`，hover `scale(1.05)`）
  - `.nsfw-overlay`（`position:absolute; inset:0; z-index:5`，`@click.stop="showNsfw = true"`）——**嵌套交互元素用 `.stop` 阻断的既有先例**
  - `.all-age-badge`（`top:12px; left:12px; z-index:10`）——右上角空闲
- `.vn-card::before` 光扫层 `z-index:1; pointer-events:none`。→ 新按钮 z-index 取 10 与徽章同层，高于 nsfw 遮罩。
- Reduced-motion 块在 `cards-detail.css:863-877`，冻结卡片位移/缩放/光扫。

### 2.2 详情弹窗（`public/index.html:203-323`）
- `selectedVN` 来自 `createDetailModal().openDetail(vn)` → `vnAPI.get(vn.id)` → `res.data`（完整条目）。`shared.js:104-138`；`tierlistPage` 也复用该 mixin（但本任务不改 tier 页）。
- 页脚 `div.modal-footer[x-show=$store.app.isAdmin]`：`[编辑 btn-secondary][删除 btn-danger]`（`:318-321`）。`.modal-footer` 为 `flex; justify-content:flex-end; gap:12px; position:sticky`（`base.css:597`）。

### 2.3 组件 `vnShelf.js`
- 数据流：`vnList`（服务端已排序）→ `applyFilters()`（搜索 ∧ 状态）→ `filteredList` → `visibleList = filteredList.slice(0, visibleCount)`。
- `loadVNList()` 会 `resetRenderWindow()`（`:134-146`）——本功能禁止调用。
- `x-for :key="vn.id"`：同 id 替换对象 → Alpine 复用 DOM，只更新绑定；卡片内 `x-data="{showNsfw}"` 状态保留。
- 现有 API 调用样板：`vnAPI.update(id, payload)` → toast `t('toast.updateOk')`；错误 `friendlyErrorMessage(error, t('prefix.saveFailed'))`。

### 2.4 API 层（`public/js/api.js`）
- `vnAPI.update(id, data)` = `PUT /api/vn/{id}`，返回完整信封；组件侧解 `res.data`（规范：禁止 `res.data || res`）。
- `friendlyErrorMessage(error, prefix)`：5xx → 通用文案（VNDB API 500 不会泄露原始 message）。

### 2.5 CSS / 交互样板
- `.btn` 系列在 `base.css:420-475`；**全站没有 `.btn:disabled` 样式**（settings 页多个 `:disabled` 按钮目前无视觉反馈）。
- 全局 focus ring：`:is(a, button, [role="button"], …):focus-visible { outline: var(--focus-ring) }`（`base.css:186`）——原生 `<button>` 自动获得，禁止组件级 `outline`。
- `@keyframes spin`（`base.css:679`）可复用；规范：loading spinner 在 reduced-motion 下**保留**。
- 无图标库，图标为内联 SVG（feather 风格 `stroke=currentColor stroke-width=2`，见 `.nsfw-overlay svg`、`.vndb-link-btn svg`）。
- 项目内无 `@media (hover: none)` 先例；断点只允许 480/768/1024。
- 状态章采用「固定深色 + 白字、与主题变量解耦」（`cards-detail.css` 状态章注释）——封面上的浮层控件可沿用此策略。

### 2.6 i18n
- 词典二级 key；相关既有 key：`common.edit/delete/saving('保存中...')/clickToShow`、`toast.updateOk`、`prefix.saveFailed/updateFailed/loadDetailFailed`、`index.searchAriaLabel/sortAriaLabel/filterStatusAriaLabel`（aria 文案放在页面域，后缀 `AriaLabel`）。
- 动态文案在 Alpine 表达式用 `$t()`，`data-i18n*` 与 Alpine 绑定互斥；`data-i18n` 只能放叶子节点。
- `tests/public/i18n.keys.test.mjs` 双向 parity + placeholder 集合一致。

## 3. 测试样板
- `tests/router/vn.status.test.mjs`：临时目录改写 `router.js` import 为 stub（auth/repository/index-task/ulist-import/vndb），`state.entries` 内存表，`state.saveCalls` 记录写入；`fetchVNDB` stub 返回 `title: 'Stub VN ' + id, rating: 8`。`sendJSON(routerModule, 'PUT', '/api/vn/v17', body)`。→ 可直接加 `refreshVNDB` 用例（同一 handler）。
- `tests/public/tier-diff.test.mjs`：纯函数模块（`public/js/tier-diff.js`，零 DOM 依赖）直接 import 单测——新增纯投影函数的样板。

## 4. 相关规范条目
- `.trellis/spec/frontend/quality-guidelines.md`
  - Forbidden：icon-only button 必须 `aria-label`；无 CDN；`res.data || res`。
  - Required：`friendlyErrorMessage` 分层；CSS 模块归属（`.btn` 归 base.css，卡片归 cards-detail.css）；focus ring 单一全局规则；新动效需 reduced-motion 对应（spinner 例外保留）；`t()`/`$t` 与 `data-i18n` 契约；信封解包 `res.data`。
- `.trellis/spec/frontend/component-guidelines.md`：shared.js mixin；Styling（BEM-ish、state class 由 `:class` 切换）；长列表渲染窗口化 Scenario（勿重置窗口）。
- `.trellis/spec/frontend/state-management.md`：`$store.app` 仅放跨组件状态——per-id busy map 属组件本地状态。
- `.trellis/spec/backend/conventions.md`：API 响应信封；settings 复用契约（本任务不触后端代码，仅加测试）。
