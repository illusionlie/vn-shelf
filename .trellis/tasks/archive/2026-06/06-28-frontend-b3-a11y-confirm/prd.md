# PRD — B3 前端交互可达性与确认 UI

> 上下文：`docs/frontend-improvements.md` 批次 B3（U1 / K3 / K2 / K4 / K5 / K7 / K9 / A1）。
> 决策 D-A（已拍板）：公共壳层走**渐进 JS 注入**（新增 `public/js/layout.js` 注入占位），保留 MPA 架构，不迁移 SPA。

## 背景

B1/B2 完成供应链与缓存优化后，B3 聚焦**不影响功能的可达性与交互体验硬伤**：模态无焦点陷阱、首页 VN 卡片不可键盘聚焦、toast 不播报、`confirm()` 阻塞反直觉、移动菜单无 ARIA 状态、五页壳层逐字重复。本批次不改任何业务行为，只补 a11y 与替换原生对话框。

## 现状修正（经核读 HTML 后，比 `docs/frontend-improvements.md` 侦察阶段更准确）

- **tier 卡片已是 `<button class="tier-vn-card" :data-vn-id="vn.id">`** （`tier.html:120`），button 原生 Enter/Space 触发 click → 键盘**已可达**，仅缺 `aria-label`。不复做 keyboard 化工作（详见下文 K2 修正）。
- **多数图标按钮已有 `aria-label`**（GitHub 链接、theme toggle、more-menu toggle 各页均有）。
- **index.html `vn-card` 仍是 `<div @click="openDetail(vn)">`**（`index.html:125`）——这才是真正不可键盘聚焦的，K2 仅针对此处。
- **more-menu toggle 有 `aria-label="Menu"` 但无 `aria-expanded`/`aria-controls`**（5 页 `:61`）。
- **`<form>` 已有 `<label class="form-label">`**（`index.html:295` 起），但顶部 **search-input / sort-select 无 label**（`index.html:81/83`）。
- **toast-container 无 `role`/`aria-live`**（5 页各 1 处）。
- **modal-close `&times;` 无 `aria-label`**（index/tier 共 4 处）；modal-overlay/modal 无 `role="dialog"`/`aria-modal`。

## 目标（8 个独立可验证交付物）

### 1. confirmDialog 组件 + 4 处 confirm 替换（U1）
- 新增 `public/js/components/confirmDialog.js` + 注册到 `app.js`；5 HTML 各加一个 `<div x-data="confirmDialog()" x-cloak>` 挂载点（或注入到 shell）。
- 全局 `Alpine.store('app')` 增 `confirm({title, message, confirmText, cancelText, danger})` 返回 Promise<boolean>，驱动 confirmDialog 显示。
- 替换 4 处 `confirm()`：
  - `settingsPage.js:193` 导入模式——改**双按钮明确选择**（合并/替换），不再依赖"确定=合并/取消=替换"反直觉。
  - `settingsPage.js:299` 清缓存确认。
  - `tierlistPage.js:253` 删 Tier 确认（danger 红色按钮）。
  - `vnShelf.js:219` 删 VN 确认（danger）。
- 验收后 `grep -rn "^\s*confirm(\| confirm(" public/js/` 应零业务调用（纯注释/字符串内的不算）。

### 2. 模态焦点陷阱 + role（K3）
- `utils.js` 新增 `trapFocus(el)` / `releaseFocus(prevActiveEl)`：聚焦 el 内首个可聚焦项，Tab/Shift+Tab 循环不外溢，记录触发元素以便关闭后还原。
- 模态容器加 `role="dialog" aria-modal="true" aria-labelledby`（指向标题）。
- 详情模态（`index.html:163`、`tier.html:212`）、编辑模态（`index.html:284`）、Tier 编辑模态（`tier.html:306`）打开时调用 trapFocus，关闭时 releaseFocus。
- 补 `@keydown.escape.window="closeXxx()"`（Alpine 全局 Esc 监听）。

### 3. 首页卡片键盘可达（K2）
- `index.html:125` `<div class="vn-card" @click="openDetail(vn)">` 改为 `<div class="vn-card" role="button" tabindex="0" :aria-label="vn.titleCn || vn.titleJa || vn.title" @click="openDetail(vn)" @keydown.enter.space.prevent="openDetail(vn)">`。
- 仅 index.html；tier 卡片已 button，K2 不动它（只补 aria-label 见下）。

### 4. Toast a11y（K4）
- 5 页 `toast-container` 加 `role="status" aria-live="polite"`。
- error 型 toast 单项改 `aria-live="assertive"`——可在 `addToast` 时按 type 渲染不同 aria-live。最小方案：容器 `aria-live="polite"` 即可覆盖大部分场景；如要按 type 区分，需渲染时给 toast 项加 `aria-live`。

### 5. 关闭按钮 aria-label（K5）
- `modal-close &times;` 4 处（index.html:169/288、tier.html:218/310）加 `aria-label="关闭"`。

### 6. 表单 label（K7）
- `index.html:81` search-input 加 `aria-label="搜索视觉小说"`；`index.html:83` sort-select 加 `aria-label="排序方式"`。（用 `aria-label` 而非 `<label for>` 因布局改动最小。）

### 7. 移动菜单 ARIA + 外部关闭（K9）
- `toggleMobileMenu`（`utils.js:55`）改造：toggle 按钮同步 `aria-expanded`，菜单容器 `role="menu"`，菜单项 `role="menuitem"`；点外部 / Esc 关闭。需能拿到触发按钮与菜单元素（用稳定的 selector，如 `.more-menu-toggle-btn` 与 `#more-menu`）。

### 8. 公共壳层渐进抽离（A1，决策 D-A）
- 新增 `public/js/layout.js`：导出 `injectShell()`，把 header（含 banner、nav、theme toggle、more-menu、进度条、background-overlay）+ toast-container 作为模板字符串注入到各 HTML 的占位 `<div id="app-shell" x-data></div>`（占位提前放在 `<body>` 顶部，配合 `x-cloak` 防闪烁）。
- 各页面**保留各自 `<main>` 主体与 body 的 `x-data` 组件声明**；只把重复的壳层抽离。
- 关键约束：
  - **active nav 高亮**需按当前页路径判断（`location.pathname`）——壳层抽离后各页失去硬编码 `class="active"`，统一由 layout.js 计算。
  - login 页**无设置/添加按钮**，壳层需容忍不同页面的额外 header-actions 按钮（如首页的"+ 添加"、settings 的登出按钮）——方案：保留各页面的 header-actions 内部按钮，仅抽离 nav + theme + more-menu 这一通用部分；或用 `<slot>` 式占位让各页注入额外按钮。**推荐**：壳层只抽离 `header.main-header` 之外的公共部分（进度条/背景/toast），header 本身因每页 active 项不同且 actions 不同，**本次先不强抽 header**，分两步走：A1a 抽非 header 公共部分（toast/progress/bg），A1b 视效果再评估是否抽 header。
  - 各页 body `x-data` 对象需在 shell 注入前/后保持可用——shell 用独立 `x-data="{}"` 占位避免影响主体。
- **本批次只做 A1a**：抽 toast-container + 进度条 + background-overlay（三者在五页完全一致、无页面差异）；header 因 active/actions 差异暂留各页，列为后续 A1b（本 PRD 范围内不做）。

## 范围外

- 拖拽键盘化（K1，B4）。
- DOMPurify / Markdown（S2，B4）。
- CSS 拆分、i18n（B5）。
- 不改任何后端、不改 API。
- 不抽离 header（A1b 留后续）。

## 约束

- 无构建步骤；仅改 `public/*.html`、`public/js/`。
- 不引入第三方库。
- **保持行为不变**：模态开关、卡片点击、confirm 流程、移动菜单功能与原先完全一致，只增 a11y 属性与键盘路径。
- 新增 `layout.js` 注入的 DOM 与原 HTML 字面一致（class、结构、Alpine 指令），避免样式回归。
- 遵守已沉淀 spec：禁 runtime CDN、禁 `{...options}` headers、禁 `Date.now()` id、Store appearance 已就绪勿破坏。

## 验收标准

| # | 条件 | 验证方式 |
|---|------|---------|
| AC1 | 4 处 `confirm()` 全部替换为 confirmDialog；导入模式为双按钮 | `grep -rn " confirm(" public/js/` 仅剩注释；人工走查 4 流程 |
| AC2 | confirmDialog 可 Tab 到确认/取消、Enter=确认、Esc=取消，焦点还原 | 键盘走查 4 处 |
| AC3 | 详情/编辑/Tier 编辑三模态加 `role="dialog" aria-modal` + Esc 关闭 + Tab 不外溢 + 关闭焦点还原 | 键盘走查 |
| AC4 | index VN 卡片可 Tab 聚焦，Enter/Space 打开详情 | 键盘走查首页 |
| AC5 | toast-container 有 `role="status" aria-live` | grep 5 页 |
| AC6 | modal-close 4 处有 `aria-label="关闭"` | grep |
| AC7 | search-input / sort-select 有 `aria-label` | grep |
| AC8 | more-menu toggle 有 `aria-expanded`、点外部/Esc 关闭 | 键盘 + 鼠标走查 |
| AC9 | `layout.js` 存在；toast-container/进度条/background-overlay 在 5 页改为注入占位；渲染后 DOM 与原一致 | grep + DevTools 对比 |
| AC10 | active nav 高亮在抽离后仍按页面正确显示 | 五页面走查对比 |
| AC11 | `npm run lint` 退出 0 | 命令 |
| AC12 | `npm run test` 退出 0 | 命令 |
| AC13 | 本地 `npm run dev` 五页面功能正常（搜索/排序/详情/编辑/删除/Tier 拖拽/设置各 Tab/统计/登录/移动菜单） | 手动冒烟 |

## 风险与回滚

- **风险**：Alpine `x-cloak` 与 shell 注入时序导致首屏闪烁 → 注入在 `<body>` 顶部占位 + CSS `[x-cloak]{display:none}` 已有则复用；冒烟确认。
- **风险**：trapFocus 与既有 `lockPageScroll` 计数逻辑冲突 → 焦点陷阱与滚动锁解耦，各自独立计数。
- **风险**：layout.js 注入破坏 `body x-data` 绑定 → shell 用独立 `x-data="{}"` 占位，不碰主体 `body` 的组件声明。
- **风险**：active nav 计算误判（如 `/` vs `/index.html`）→ 归一化 pathname（`/index.html` 视为 `/`）。
- **回滚**：8 交付物按文件分提交；A1a 抽离若难收敛可整体 revert，其余 7 项独立保留。

## 设计要点（详见 implement.md）

- `confirmDialog` 作为 Alpine.data 组件挂载到各页（或注入到 shell）；Store.app.confirm 通过共享 Store 状态驱动它（`store.app._confirmState`：title/message/.../resolve）。
- `trapFocus`：监听 `keydown` Tab，在容器内首个可聚焦与末个之间循环；记录 `document.activeElement` 作为 `releaseFocus` 目标。
- `layout.js`：`injectShell()` 在 `alpine:init` 之前或 `DOMContentLoaded` 时把三段公共 DOM 写入占位；占位用 `<template>` 或直接 innerHTML。
- 移动菜单 K9：`toggleMobileMenu` 改为操作并同步 toggle 按钮 `aria-expanded`，全局监听 `click`（点菜单外关闭）与 `keydown`（Esc）。需挂载/卸载监听，避免重复绑定。