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

- **Single global stylesheet**: `public/css/style.css` (~1900 lines), served as-is by Worker Assets. No CSS-modules, Tailwind, styled-components, or build-time processing.
- **Class naming**: BEM-ish scoped by component (`.vn-card`, `.vn-card-image-wrapper`, `.modal`, `.modal-header`, `.tier-vn-card`, `.toast`, `.toast-error`). Convention: block-element-modifier via hyphens; state classes `.active` / `.dragging` / `.hidden` toggled by Alpine `:class`.
- **Alpine binds DOM ↔ field**: prefers `x-show` / `:class` / `:style` over imperative DOM ops. Inline `:style` is allowed only for truly dynamic per-instance values (e.g. NSFW overlay radius, dragged-card transform) — structural styling goes in `style.css`.
- **Dark mode**: `body.dark-mode` class (set by `theme.js` from `localStorage.theme`) overrides CSS variables; do not write `prefers-color-scheme` media queries — the toggle is manual.
- **Focus-visible**: every interactive element should have a visible `:focus-visible` outline. The project has historically under-covered this (B3 audit found only ~7 focus selectors) — when adding new interactive elements, add the `:focus-visible` rule alongside the install.

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
