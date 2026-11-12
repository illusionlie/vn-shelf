# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

本项目为 Alpine.js MPA：`public/js/components/` 下每个页面组件导出一个 factory function，由 `app.js` 统一注册（`Alpine.data('vnShelf', vnShelf)`）。

### Convention: 跨页面共享逻辑走 shared.js mixin

**What**：页面组件需要 tags 显示（配置加载/翻译/热刷新）或详情弹窗时，**必须混入 `public/js/components/shared.js` 的 factory**，禁止在组件内重写同等逻辑：

```js
import { createDetailModal, createTagsView } from './shared.js';

export function myPage() {
  return {
    ...createTagsView(),    // config / translations / loadConfig / initTranslations
                            // / getDisplayTags / setupTranslationsRefresh
    ...createDetailModal(), // selectedVN / showDetail / openDetail / closeDetail
    _initialized: false,
    async init() {
      if (this._initialized) return;
      this._initialized = true;
      this.setupTranslationsRefresh(); // 挂监听置于 loadConfig 之前，避免后台更新竞态
      await this.loadConfig();
      await this.initTranslations();
      // ...页面自身加载
    }
  };
}
```

**Why**：2026-06 之前 `vnShelf` 与 `tierlistPage` 各自复制了约 80 行同等逻辑，曾出现同一方法两种名字（`getDisplayTags` vs `getDetailTags`）导致 HTML 模板绑定漂移。

**契约要点**：

- mixin 方法内的 `this` 指向宿主 Alpine 组件实例，依赖 `this.$store.app.addToast`，宿主页面必须已注册全局 store。
- `loadConfig` 走**公开端点** `configAPI.getAppearance()`（含 `tagsMode/translateTags/translationUrl`），匿名访客与管理员看到一致的 tags；不要改回需认证的 `configAPI.get()`（会让访客每次加载吃 401 并回退默认配置）。
- `setupTranslationsRefresh` 监听 `translations-updated`（`translations.js` 后台更新缓存后 dispatch），从 IndexedDB 重读并赋值 `this.translations` 触发响应式刷新；MPA 无需 teardown，靠 `_initialized` 守卫防重复挂载。
- 新增共享成员时先检查两个现有消费方（`vnShelf.js`、`tierlistPage.js`）的同名成员冲突——对象展开后写在后面的覆盖 mixin。

---

## Scenario: 远程 type-ahead combobox（07-26 固化，样板：添加弹窗 VNDB 搜索）

**What**：任何「输入 → 防抖请求后端 → 下拉候选 → 点选回填」组件必须同时具备**四层守卫**，缺一即实证 bug（07-26 check 阶段抓到 ③④ 缺失）：

```js
// 参考实现：vnShelf.js 的 vndbSearch* 状态组（350ms debounce，≥2 字符触发）
_seq: 0,            // ① 竞态序号：请求前 ++ 并快照，success 与 error 两分支都只在 seq 最新时写状态
_composing: false,  // ② IME 守卫 A：@compositionstart/@compositionend 维护；组字中 input 事件不分流，end 后补一次
// ③ IME 守卫 B：keydown 处理器入口 if (event.isComposing) return;
//    否则 ↑↓ 抢输入法候选导航、组字确认的 Enter 误选高亮候选
// ④ 关闭作废：closeDropdown() 内 _seq += 1，且防抖回调入口 if (!open) return;
//    否则防抖窗口内 Esc/外点/选中后，延迟回调重开"幽灵下拉"、in-flight 响应回写旧结果
```

**模态内层级契约**：

- Esc：下拉开 → 关下拉 + `stopPropagation()`（模态的 `@keydown.escape.window` 挂冒泡末端，可被内层阻断）；下拉关 → 不拦截，Esc 照常关弹窗。
- Enter：下拉开 → `preventDefault()` 选中高亮项（防触发外层 `<form>` 提交）；下拉关 → 不拦截。
- 候选行用 `@mousedown.prevent` 选中（保持输入框焦点，避开 blur 时序）；外点关闭用 `@click.outside`。
- 提交守卫写在组件方法内而非 HTML `required`——modal footer 按钮在 `<form>` 外，原生校验从不生效。

**a11y 与状态呈现**：`role=combobox`（`aria-expanded/controls/activedescendant`）+ `role=listbox/option`（`aria-selected`）；searching/error/empty/results 四态**内联**展示于下拉区，不走 toast（逐击键刷屏）。

**Why**：四层守卫各对应一个真实失效模式——过期响应覆盖新结果（①）、半截拼音打到后端（②）、组字 Enter 误选（③）、关闭后幽灵重开（④）。中文输入是本项目主用例，②③ 不是边缘场景。

**Related**：backend/conventions.md「VNDB 搜索代理端点（07-26）」（服务端契约）；quality-guidelines.md（modal Esc/a11y 总则）。

---

## Props Conventions

This project has **no props** — Alpine.data components are factory functions returning plain objects, mounted via HTML `x-data="componentName()"`. Parent↔child data flow happens through:

- **`Alpine.store('app')`** for cross-component/cross-page shared state (`isAdmin`, `isLoading`, `toasts`, `appearance`, `_confirmDialog`, the `confirm()` Promise API). See `state-management.md`.
- **`x-model`** binding HTML inputs directly to component fields (no controlled-prop plumbing).
- **Mixin factories** (`createTagsView()` / `createDetailModal()` in `shared.js`) for composing shared logic into a page component via object spread — see "Component Structure" above.

Do NOT invent a prop-passing API; Alpine's reactivity model doesn't need one. If two components on the same page must coordinate, promote the shared field to `Alpine.store('app')` rather than threading it through the DOM.

---

## Styling Patterns

细则（CSS 模块归属与 `<link>` 顺序、断点、动效时长、焦点环、主题挂载点）都在 `quality-guidelines.md`；此处只记组件侧的写法约定：

- **CSS 是拆分的页面级模块，不存在单一 `style.css`**：`public/css/` 下按 `base` → `forms` → `cards-detail` → 页面文件 的顺序 `<link>`，后者可覆盖前者。组件样式就近落页面模块；被 JS 注入的共享 DOM（壳层 / 页脚 / markdown）或 3+ 页面共用的类才上提到 `base.css`。
- **类名 BEM-ish**：块-元素-修饰词用连字符（`.vn-card` / `.vn-card-image-wrapper` / `.modal-header`），状态类 `.active` / `.dragging` / `.hidden` 由 Alpine `:class` 切换。
- **Alpine 绑定 DOM ↔ 字段**：优先 `x-show` / `:class` / `:style` 而非命令式 DOM 操作。内联 `:style` 只留给真正的逐实例动态值（NSFW 遮罩圆角、拖拽卡片 transform）；结构性布局一律进页面 CSS 模块的具名类，页面标记里不写 `style=`。
- **暗色主题 class 挂在 `<html>`**：`html.dark-mode`，由各页 `<head>` 的内联脚本在首帧前写入（`theme.js` 的 `initTheme()` **不**负责写这个 class）。组件里不要写 `prefers-color-scheme` 媒体查询，也不要用 `body.dark-mode`——主题是手动开关，系统偏好只是无存储值时的初值。
- **键盘焦点环来自 `base.css` 的唯一一条全局规则**（`--focus-ring` + `:is(a, button, [role="button"], select, input, textarea):focus-visible`）。新交互元素只要是原生控件或带 `role="button"` 就自动获得焦点环，**不要**自己写 `outline`：自己写会与全局规则打架，而漏写则是「加了个点不到的元素也看不出问题」的隐性 a11y 缺陷。

---

## Accessibility

See `.trellis/spec/frontend/quality-guidelines.md` — a11y is fully codified there (forbidden native `confirm()`, modal `role=dialog` + `trapFocus` + panel-level Esc, `@click` divs need `role+tabindex+@keydown`, icon buttons need `aria-label`, toggles need `aria-expanded`/`aria-controls`, `aria-live` for toasts). Do not duplicate those rules here; apply them whenever you build a new component.

---

## Common Mistakes

- **Duplicating shared logic across page components.** `vnShelf.js` and `tierlistPage.js` once each had ~80 lines of identical tag-config/detail-modal code, drifted into two method names (`getDisplayTags` vs `getDetailTags`) and broke HTML bindings. Always spread `createTagsView()` / `createDetailModal()` from `shared.js` instead.
- **Binding `this` in `x-init` expressions.** `$store.app._confirmDialog = this` did NOT bind the component instance — `this` in an `x-init` Alpine expression resolves to the outer evaluation context (often `window`), so `.show` was `undefined`. Bind store handshakes inside the component's `init()` method where `this` is the instance (B3 bug).
- **Routing `settingsPage.loadConfig` through the appearance Store.** `/api/config/appearance` is public and excludes auth-only fields (`hasVndbApiToken`/`hasPassword`). Settings UI reads those, so `loadConfig` must stay on authenticated `/api/config` — don't unify onto the appearance Store (B2 learned this).
- **Adding a per-page toast/progress/background block.** These shared shell elements are injected by `public/js/layout.js` `injectShell()` (B3). Copy-pasting them per HTML page is a DRY violation and a fall-back path drift risk.
- **Reaching for native `confirm()` in a new flow.** Forbidden per quality-guidelines — use `await this.$store.app.confirm({...})`. Native confirm blocks, is un-stylable, and its OK/Cancel semantics are ambiguous (import mode 「OK=合并 / Cancel=替换」 antipattern).

---

## Scenario: 长列表渲染窗口化（08-28 固化，样板：首页书架）

**What**：条目量级达到几百以上时，`x-for` 全量渲染的 DOM/绑定数是实际瓶颈（数据本身极小）。不引入分页/虚拟滚动，用「窗口切片 + 哨兵追加」：

```js
// 参考实现：vnShelf.js（RENDER_PAGE_SIZE / AUTO_LOAD_BUDGET）
visibleCount: PAGE_SIZE,          // 窗口大小；x-for 绑定 visibleList 而非 filteredList
autoLoadsLeft: BUDGET,            // 自动追加预算，用尽转「加载更多」按钮（保证 footer 可达）
get visibleList() { return this.filteredList.slice(0, this.visibleCount); },
get hasMore()     { return this.filteredList.length > this.visibleCount; },
```

**契约要点**：

- 全量列表（`filteredList`）保留用于过滤/计数；`x-for` 只消费 getter 切片。搜索/排序/过滤/重载四处显式 `resetRenderWindow()`（保持可 grep，不用 `$watch`）。
- IntersectionObserver 哨兵带 `rootMargin` 预取；**IO 只在交叉状态跳变时触发**——追加后哨兵仍在视口内不会自动再触发，每次追加后必须 `$nextTick` 手动复检一次。
- 无 IO 环境降级 `visibleCount = Infinity` 全量渲染，不报错。
- 自动预算用尽后必须给手动按钮——纯无限滚动会让 in-flow footer 永远不可达。
- MPA 无需 disconnect observer（与 `setupTranslationsRefresh` 同一前提）。

**Why**：一次拉取 + 本地即时过滤/排序是本项目首页的核心体验资产，服务端分页会摧毁它；窗口化以约 30 行解决唯一真实瓶颈（DOM 节点数）。

**Related**：quality-guidelines.md（column-flex + auto-margin shrink-wrap 陷阱——配套 sticky footer 布局时实证踩中）。

---

## Scenario: 单条目就地更新（09-09 固化，样板：管理员单条目 VNDB 刷新）

**What**：对列表中某一条做写操作后，不重拉整表、不 `resetRenderWindow()`，用响应实体就地替换该条：

```js
// 参考实现：vnShelf.js refreshVN / applyRefreshedEntry + public/js/vn-list-item.js
refreshing: {},                                   // per-id busy map（普通对象，不用 Set）
async refreshVN(id) {
  if (!id || this.refreshing[id]) return;         // 同 id 重入守卫；不同 id 可并行
  this.refreshing[id] = true;
  try {
    const res = await vnAPI.update(id, { refreshVNDB: true });
    this.applyRefreshedEntry(res.data);
  } finally { delete this.refreshing[id]; }
},
applyRefreshedEntry(entry) {
  const idx = this.vnList.findIndex(item => item.id === entry.id);
  if (idx !== -1) {
    this.vnList[idx] = mergeVndbIntoListItem(this.vnList[idx], entry);   // 纯函数投影
    this.filteredList = this.applyFilters(this.vnList);                 // 重放过滤，不重置窗口
  }
  if (this.selectedVN?.id === entry.id) this.selectedVN = entry;         // 已打开的详情同步
}
```

**契约要点**：

- **完整条目 → 列表项的投影是跨端同值约定**：`public/js/vn-list-item.js mergeVndbIntoListItem` 逐字段镜像 `src/repository.js rowToListItem`（`titleJa = vndb.titleJa || vndb.title`、`titleCn = user.titleCn || vndb.titleCn`、`rating` 非负归一、`developers` 数组守卫）。改一侧必须同步另一侧；`tests/public/vn-list-item.test.mjs` 钉住口径。纯模块零 DOM/API/i18n import（同 `tier-diff.js`），才能被 node:test 直接引用。
- `x-for :key="vn.id"` 下同 id 换对象 → Alpine 复用 DOM 只刷绑定，卡片内 `x-data` 局部状态（如 `showNsfw`）保留。
- 只替换本次操作真正改变的字段族（此处仅 VNDB 派生字段），其余沿用旧列表项——避免为一次点击重造全字段投影。
- 排序不就地重排（避免卡片跳位）；搜索/状态筛选通过 `applyFilters` 重放，条目因标题变化不再匹配时消失是正确行为。
- **后端 `saveVNEntry` 是 `INSERT OR REPLACE` 整行写入**：任何"先读后写"的在途请求都会用旧快照覆盖并发写、甚至复活刚被 DELETE 的行。因此同一条目在途期间，模板必须禁用其它会写该行的入口（编辑/删除 `:disabled="isRefreshing(id)"`）。根治（`updatedAt` 乐观锁）另立任务。

**Why**：`loadVNList()` 语义上耦合了渲染窗口重置（首页核心体验），单条目写操作走它会丢滚动位置与已展开窗口；8 个字段的就地合并成本远低于整表重传。

**Related**：quality-guidelines.md「busy 按钮用 aria-disabled 保焦点」「role=button 容器内嵌套控件的 .stop 契约」。

---

## Scenario: 统一详情弹窗注入（09-12 固化，样板：index/tier 共用弹窗）

**What**：跨页面共享的弹窗模板走「JS 模板字符串 + mount 注入」（`public/js/detail-modal.js` 的 `injectDetailModal()`），页面 HTML 只留 `<div id="detail-modal-mount"></div>`——**mount 必须在页面 `x-data` 根内**（两页均为 `<body x-data>`，mount 放原弹窗位置即契约成立）。

**契约要点**：

- **注入时序**（app.js 固定顺序）：`injectShell() → injectFooter() → injectDetailModal() → applyI18nDom() 首遍`。两个前提：注入发生在 Alpine 接管之前（confirmDialog 经 injectShell 注入的成熟先例）+ 首遍 i18n 扫描之前（模板内 `data-i18n` 标记含嵌套 `<template>`，`applyI18nDom` 递归 `template.content` 处理）。**禁止 top-level await**（app.js 与 alpine.min.js 执行顺序约束）。
- 无 mount 的页面（login/settings/stats）注入函数空操作，不报错。
- **页脚 admin 按钮形态**：`<template x-if="$store.app.isAdmin">` 包裹（访客**不进 DOM**，勿改回 x-show）；「编辑」钮 `x-show="detailCanEdit"`（vnShelf `true`、tierlistPage `false`——编辑表单仍为 index 专属，后续任务再统一）。
- **管理员动作 mixin**：`shared.js createDetailAdminActions()` 无参工厂 + **宿主钩子对象展开覆盖**（`applyDetailEntryUpdated` / `applyDetailEntryRemoved`）——不用工厂参数传钩子（组件对象构造时拿不到宿主 `this`，展开覆盖是 shared.js 既有惯例）；busy map 字段名沿用 `refreshing`。vnShelf 的钩子 = 09-09 就地更新（上方案板）；tierlistPage 的钩子 = tier 分组内按 id 替换/移除 + `rebuildTierGroups`（空 tier 行保留占位）。
- **共享 helper 上移**：`statusBadgeLabel` / `statusIcon` → `utils.js` 导出（依赖 `t()`，组件挂 shorthand 引用、模板绑定名不变）；其白名单 `VN_STATUS_OPTIONS` → `constants.js`（与后端 `src/repository.js VN_STATUS_VALUES` 注释互指同步，UI 不含预留 wishlist）。

**Why**：两份 95~133 行模板复制粘贴已实际漂移（评分形式、状态徽章、管理按钮三处分叉）；单一注入实现后两页字段口径由同一模板保证，Tier 页顺带获得管理员能力（刷新 + 删除，2026-09-12 用户决策）。

**Related**：下方「弹窗生命周期守卫」；quality-guidelines.md CSS 模块归属（注入共享 DOM 样式归 base.css / detail 类归属不变）；`tests/public/i18n.keys.test.mjs`（统一模板复用既有 key，零新增）。

---

## Convention: 弹窗生命周期守卫（withModalGuard，09-12）

**What**：`public/js/utils.js createModalGuard({ lockScroll = true })` → `{ open(), trap(el), close() }`，全部四类弹窗（详情 / index 编辑 / tier 编辑 / confirmDialog）的生命周期工具**仅存 utils.js**，禁止再手写 lock/trap/release 样板。

**契约要点**：

- `open()` / `close()` 配对锁滚动（幂等旗标防重复 lock——保留原「已开不重复 lockPageScroll」语义）；`close()` 内 `try { release() } catch { /* 静默降级 */ }` **逐字保留**旧 4 处重复块的语义。
- `trap(el)` 独立于 `open()`：必须在 Alpine `$nextTick` 回调内调用（utils.js 不依赖 Alpine，与旧代码时序逐字等价）。
- confirmDialog 用 `{ lockScroll: false }`：它叠加于内容模态之上，自身不锁滚动（close 只释放 trap 不动计数），`_lastFocus` 双还原逻辑不变。
- 备选形态（勿采用）：`open(getEl)` 单入口——需要把 `$nextTick` 时序拉进守卫内部，utils.js 将被迫依赖 Alpine。

---

## Convention: Alpine 类钩子显隐过渡（modal / 浮层动效单一事实源，09-15 motion-polish）

**What**：弹窗与浮层的显隐动效统一走 Alpine **类钩子全套**（`x-transition:enter` / `enter-start` / `enter-end` / `leave` / `leave-start` / `leave-end`）+ CSS 钩子类。现有实现：4 处 modal（`detail-modal.js` / `layout.js` confirmDialog / `index.html` 编辑 / `tier.html` Tier 编辑）用 `modal-fade-*`（overlay 淡入淡出）+ `modal-scale-*`（主体缩放），`index.html` VNDB 搜索下拉用 `dd-grow-*`（origin-aware `transform-origin: top` 生长/收束）。

**契约要点**：

- **单轨**：overlay 与主体同走 `x-show` 轨，overlay 不再用 `:class="{active}"` 类切换驱动 CSS transition——双轨（类切换 overlay + x-transition 主体）曾导致两层速度脱节（300ms vs 150ms）且 reduce 需 `!important` 压内联样式（已退役）。
- **六类齐全**：每个元素 6 个钩子属性缺一不可。canonical 语义：`enter-start` = 隐藏态、`enter-end` = 可见态；`leave-start` = 自然可见态、`leave-end` = 隐藏态。漏 `leave-end` → Alpine 单 rAF swap 后元素回到自然可见态，退出阶段反向淡入再 `display:none`。
- **CSS 单一事实源**：时长/easing/位移全在钩子类里（open 250ms / close 150ms / `cubic-bezier(0.22,1,0.36,1)`，见 quality-guidelines motion scale）；Alpine 不写内联样式，收尾靠 computed `transition-duration` 的 setTimeout，reduce 由常规媒体查询接管。
- **x-cloak 防初始化闪烁**：overlay 删掉 CSS 隐藏基础态后，HTML 解析到 Alpine 接管之间会闪现——overlay 必须带 `x-cloak`（`[x-cloak]` 全局规则兜底，主体作为后代无需重复标记）。
- **与 withModalGuard 正交**：守卫只依赖 `x-show` / `x-ref` / `body.modal-open`，与显隐动效机制零耦合；改动动效不得触碰 `@click.self` / `@keydown.escape.window` / `x-ref` / `role="dialog"` / `aria-*`。
- **新增浮层动效时**：复制 `dd-grow-*` 模式（命名 `<surface>-<verb>-<phase>`），钩子类落在该浮层样式所在的 CSS 模块（dropdown 类进 forms.css，modal/toast 类进 base.css），reduce 块同文件配对。

**Wrong vs Correct**：

```html
<!-- Wrong：裸 x-transition 写内联样式，reduce 需 !important；且与 overlay 类切换双轨脱速 -->
<div class="modal-overlay" :class="{ active: show }">
  <div class="modal" x-show="show" x-transition>…</div>
</div>

<!-- Correct：单轨 x-show + 六类钩子，动效全在 CSS -->
<div class="modal-overlay" x-show="show" x-cloak
     x-transition:enter="modal-fade-enter" x-transition:enter-start="modal-fade-enter-start"
     x-transition:enter-end="modal-fade-enter-end" x-transition:leave="modal-fade-leave"
     x-transition:leave-start="modal-fade-leave-start" x-transition:leave-end="modal-fade-leave-end">
  <div class="modal" x-show="show" x-ref="modal"
       x-transition:enter="modal-scale-enter" x-transition:enter-start="modal-scale-enter-start"
       x-transition:enter-end="modal-scale-enter-end" x-transition:leave="modal-scale-leave"
       x-transition:leave-start="modal-scale-leave-start" x-transition:leave-end="modal-scale-leave-end">…</div>
</div>
```

**Related**：quality-guidelines.md「reduced-motion counterpart」与「Motion timing scale」（09-15）；上方「弹窗生命周期守卫（withModalGuard，09-12）」。

---

## Scenario: 长表单页按配置类型分页（tablist，11-10 固化，样板：设置页）

**What**：一个塞得很长的表单页（设置）按「管的是什么」拆成 5 个分类，桌面左侧栏 / 窄屏顶部横滑标签，同一时刻只显示一个面板。样板：`public/settings.html` + `public/js/components/settingsPage.js` + `public/js/settings-tabs.js` + `public/css/settings.css`。

**结构**：

```js
// settings-tabs.js —— 纯模块：零 DOM / API / i18n import、无副作用（同 tier-diff.js 口径）
export const SETTINGS_TABS = Object.freeze(['vndb', 'appearance', 'tags', 'security', 'data']);
export function resolveSettingsTab(hash)      // hash → 分类 id；空 / 未知 / 原型键一律回落默认
export function nextSettingsTab(current, key) // 键盘 key → 目标分类；非导航键返回 null

// settingsPage.js
activeTab: resolveSettingsTab(window.location.hash),  // 工厂内即取值——首帧就是正确分类，不闪默认分类
setupTabs() { window.addEventListener('hashchange', …); new ResizeObserver(() => this._syncNavLayout()); }
_applyTab(tab) { this.activeTab = tab; window.scrollTo({ top: 0, behavior: 'instant' }); … }
selectTab(id)  { this._applyTab(tab); history.replaceState(history.state, '', `#${tab}`); }
```

**契约要点**：

- **分类 id 三处同值**：DOM id 后缀（`settings-tab-<id>` / `settings-panel-<id>`）、URL hash、纯模块的 `SETTINGS_TABS`。手写标记与常量表必然漂移，所以 `tests/public/settings-tabs.test.mjs` 读 `settings.html` 源码钉住：两侧顺序与取值全等、tab↔panel 的 `aria-controls`/`aria-labelledby` 互指、`<main>` 内无内联 `style=`。**读源码的正则必须锚定结束的 `>`**（`<div[^>]*id="…"[^>]*>`）——只用 `<div[^>]*id="…"` 时 `[^>]*` 会越过首个 `>` 一路吃到下一个元素，把嵌套结构里的元素误判成标签本身。
- **面板一律 `x-show` + `x-cloak`，绝不用 `x-if`**：`x-if` 销毁 DOM，会丢掉已输入未保存的值、常驻 `x-ref`（Turnstile 测试容器）与轮询绑定。`x-cloak` 防 Alpine 接管前所有面板同时闪现。
- **hash 是当前分类的镜像，不是第二事实源**：`selectTab` 走 `replaceState`（后退键该离开设置页，而不是逐个倒回分类）；`replaceState` 不派发 `hashchange`，不会自触发。分类 id 不得与页面内任何元素 id 相同，否则原生锚点滚动会插一脚。
- **`aria-orientation` 跟随渲染结果，不跟随断点常量**：导航桌面纵向、窄屏横排，朝向读 computed `flex-direction` 同步——CSS 是唯一事实源，断点数值不重复写进 JS。方向键两轴都接受（两套都自然），这个属性只影响读屏播报口径。
- **导航尺寸相关的呈现统一挂一个 ResizeObserver**：不只是「选中项居中」——`en` 词典懒加载会在首屏之后二次写入文案、改变标签宽度，窗口缩放同理。RO 回调只写 `navOrientation`（同值不触发 Alpine effect）与 `scrollLeft`（不改 border-box 尺寸），无回环。
- **横滑导航里把选中项带入视野靠写主滚动容器的 `scrollLeft`，不要用 `scrollIntoView`**：后者会连带滚动整个页面，在刷新时与浏览器的滚动位置恢复打架。
- **页面专属字段宽度用页面根上的自定义属性分档**：`.settings-layout { --settings-field-short: 360px; --settings-field-long: 560px }`，移动档只把变量改成 `100%`。`forms.css` 的全局默认（`width: 100%`）不动，其他页面的表单因此零影响。长档的「输入框 + 按钮」行让输入框 `flex: 1; min-width: 0`、按钮 `flex-shrink: 0; white-space: nowrap`，否则按钮会被挤成竖排两行。
- **选中项不要比未选中项更难读**：色板里 `--accent-color`（#007AFF）的亮度高于 `--secondary-text-color`，所以「accent 文字 + accent tint 底」的常规选中写法在浅色档约 3.0:1、深色档约 3.8:1，而同一容器里的未选中项是浅 4.6 / 深 6.8（改后约 12.7 / 11.8；均按 base.css 声明色值叠算，不含自定义背景图） —— 选中项反而最不清晰。正确写法是 **accent tint 底 + `--primary-text-color` 文字 + accent 图标**：底色承担「当前位置」，色相提示交给图标。
- **`window.scrollTo({ behavior: 'instant' })` 是有意的例外**：切分类 = 换一屏内容，不走 `base.css` 的 `html { scroll-behavior: smooth }`（否则新面板边滚边换）。这与 `layout.js` 回顶按钮「省略 `behavior`、把 smooth-vs-instant 交给 CSS」的选择**方向相反且都正确**——回顶是页内导航，切分类是内容替换。不要来「统一」这两处。
- **状态点用可读文本，不只靠颜色**：`role="tab"` 内的运行中指示点写 `role="img"` + `data-i18n-aria-label` / `data-i18n-title`。代价是该文本会并入 tab 的可访问名（读屏读成「VNDB 同步 任务进行中」）；若将来要避免名字长度抖动，改用 `aria-describedby` + 视觉隐藏文本。

**Why**：设置页原状是 9 个分区纵向堆一页、控件横贯 1247px（1440 视口），整页 3779px；「保存」「清除」因无防收缩被压成竖排。分页后每类 900–1245px，字段宽度与它装的内容相称（短档 360 / 长档 560）。

**Related**：quality-guidelines.md（CSS 模块归属与断点约束、全局 `:focus-visible` 单一来源、reduced-motion 同文件配对、内联样式禁令）；`state-management.md`（组件局部状态的生命周期）。
