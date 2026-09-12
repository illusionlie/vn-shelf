# 技术设计：详情弹窗统一与弹窗生命周期重构

## 架构

新增 `public/js/detail-modal.js`：`injectDetailModal()` 以 innerHTML 模板字符串注入统一详情弹窗（`layout.js` `injectShell` / `injectFooter` 同模式，纯 DOM、无 Alpine 依赖）。

- `index.html` / `tier.html`：删除各自内联详情弹窗，原位置留 `<div id="detail-modal-mount"></div>`。**mount 必须在页面 x-data 根内**——两页现状弹窗就在组件作用域里，位置不动即契约成立。
- `app.js`：`injectFooter()` 之后调用 `injectDetailModal()`（须在首遍 `applyI18nDom` 之前，注入模板的 `data-i18n` 标记随首遍翻译就位——与 injectFooter 同契约，app.js:26-28 注释）。
- 无 mount 的页面（login / settings / stats）函数空操作。
- **注入 DOM 由 Alpine 接管是成熟先例**：confirmDialog 本身就是 injectShell 注入的 x-data 组件（app.js:24 注释），与 $refs / x-show / x-transition 完全兼容。

## 统一模板口径（以 index 版为基准，2026-09-12 已确认）

| 呈现项 | 统一后 | 变动方 |
|--------|--------|--------|
| 标题 | vndb.org 链接 + 外链图标按钮 | tier 版升级（纯文本 span → 链接） |
| 状态徽章 | 保留 `statusBadgeLabel` / `statusIcon` | tier 版补齐 |
| 评分 | 单 ★ + 数字 + 颜色语义（.detail-stars / .detail-rating-score） | tier 版弃十星级行 |
| NSFW 遮罩 / allAge / tags / 简评 / meta | 两版已一致，原样保留 | — |
| 页脚 | `$store.app.isAdmin` 时显示：刷新 + 删除恒在；「编辑」`x-show="detailCanEdit"` | tier 版新增（刷新 + 删除） |

`detailCanEdit` 为组件级标志：vnShelf `true`、tierlistPage `false`（本期决策：编辑表单注入另立任务）。

**模板依赖的组件方法**：`openDetail` / `closeDetail`（shared mixin 已有）、`statusBadgeLabel` / `statusIcon`、`refreshVN`、`deleteVN`、`formatUserPlayTime`、`getDisplayTags`、`renderMarkdown`、`openEdit`（仅 vnShelf）。实现首步定位 `statusBadgeLabel` / `statusIcon` / `formatUserPlayTime` 的现定义位置：若为 vnShelf / 组件私有，上移至共享层（utils.js 或 constants.js 导出），两组件统一引用——**tier 页获得完整徽章能力的前提**。

## 管理员动作共享 mixin（shared.js 新增 `createDetailAdminActions`）

```js
createDetailAdminActions({ onEntryUpdated, onEntryRemoved })
  → { refreshingIds: {}, isRefreshing(id), refreshVN(id), deleteVN(id) }
```

- `refreshVN(id)`：`vnAPI.update(id, { refreshVNDB: true })`；per-id busy map + `aria-disabled` / `aria-busy` 语义按 09-09 spec Scenario（busy 按钮保焦点、role=button 内嵌控件 `.stop`、封面 z-index 阶梯）；成功后调 `onEntryUpdated(entry)` 并同步已打开的 `selectedVN`；失败 `friendlyErrorMessage` toast。
- `deleteVN(id)`：`$store.app.confirm` 确认 → `vnAPI.delete(id)` → `onEntryRemoved(id)` + 关闭弹窗 + toast。
- vnShelf：现有 `refreshVN` / `deleteVN` 重构为委托该 mixin，`onEntryUpdated` 走既有列表项合并（vn-list-item.js 投影镜像 + INSERT OR REPLACE 在途互斥语义不变）——**行为零变化**。
- tierlistPage：`onEntryUpdated` 在 tier 分组结构中按 id 替换条目；`onEntryRemoved` 移除并收缩空 tier 显示（tier 页无渲染窗口，较 index 简单）。

## withModalGuard（public/js/utils.js 新增）

```js
createModalGuard() → { open(getEl), close() }
```

- `open`：`lockPageScroll()` + `trapFocus(el)` 持有 release
- `close`：`try { release() } catch { /* 静默降级 */ }` + `unlockPageScroll()` + release 置空——**try/catch 静默降级语义逐字保留**（4 处现状的共有契约）
- 替换 4 处：shared.js `createDetailModal`（`openDetail` 的条件锁滚动语义保留：`showDetail` 已为 true 时不重复 lock）、vnShelf 编辑弹窗（vnShelf.js:481-488）、tierlistPage tier 编辑弹窗（tierlistPage.js:228-235）、confirmDialog（confirmDialog.js:113-120）
- 各弹窗 Esc / overlay 自关闭行为不动（HTML 层 `@keydown.escape.window` 与 confirmDialog 互斥判断原样保留）

## CSS 归位

- `.modal*` 样式本就集中在 base.css:504-620，`.detail-*` 在 cards-detail.css——统一模板是两页共享的注入 DOM，**归属契约不变**（JS 注入共享 DOM 样式进 base.css 的既有契约适用于新增壳层元素，本任务复用既有 detail 类名，预计零新增样式）。
- 清理 tier 版十星级行独有样式（`.stars-container` 及配套 `.star.empty` 规则，cards-detail.css）——删除前 grep 确认无其他引用。
- status-badge 样式两页同一 CSS 链路（cards-detail.css 同文件），tier 页补齐徽章无需新样式。

## i18n

统一模板全部复用 index 版既有 key；预计**零新增 key**。若实现中发现 tier 页需要新文案（如删除确认上下文），双词典同步 + parity 测试（tests/public/i18n.keys.test.mjs）卡住。

## 兼容与回滚

- 无后端变更、无数据迁移。
- 单 commit 内聚（detail-modal.js + 两 HTML + app.js + shared.js + utils.js + 三组件 + CSS 清理），整体 revert 即回滚。
- 风险点与预案：
  - Alpine 对注入 DOM 的初始化时序——先例（confirmDialog 经 injectShell）证明可行；若 `$refs.detailModal` 不可达，检查 mount 是否在 x-data 根内（实现验证清单第 1 项）
  - `x-data="{ showNsfw: false }"` 内联作用域（模板 235 行）随模板整体迁移，不受注入影响
