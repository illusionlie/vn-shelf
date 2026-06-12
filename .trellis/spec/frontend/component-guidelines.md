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

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

(To be filled by the team)
