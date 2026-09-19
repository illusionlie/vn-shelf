# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled (B1: vendor layout; B5b: i18n.js + locales/; B5c: css/ split modules; project structure) |
| [Component Guidelines](./component-guidelines.md) | Component patterns, mixin composition, a11y | Filled (shared.js mixin + props/styling/a11y/mistakes; 07-26: remote type-ahead combobox 四层守卫契约; 09-09: 单条目就地更新 Scenario——vn-list-item.js 投影镜像 rowToListItem + INSERT OR REPLACE 在途互斥; 09-12: 统一详情弹窗注入 Scenario + withModalGuard 契约——mount 注入时序 / admin 页脚 x-if / createDetailAdminActions 宿主钩子; 09-15: Alpine 类钩子显隐过渡——单轨 x-show + 六类钩子 / CSS 单一事实源 / x-cloak 防初始化闪烁 / 与 withModalGuard 正交) |
| [Hook Guidelines](./hook-guidelines.md) | Stateful logic extraction in Alpine.js (no React hooks) | Filled (Alpine equivalents of React hooks; mixin factories; data fetching) |
| [State Management](./state-management.md) | Local state, global store, server state | Filled (B2: appearance Store + Promise dedupe + config endpoint split + IDB cache; 09-19: appearance 网络路径恒 no-store——冷启动陈旧 0s，sessionStorage 唯一客户端缓存层) |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns, a11y | Filled (B1/B3/B4: vendor self-host, header merge, Date.now id, native confirm, modal role/Esc, keyboard div, friendlyError layering, code-review checklist; B5b: i18n t() contract + backend-message boundary; B5c: CSS module placement + link-order contract; B6d: card-grid density tiers + aspect-ratio cover contract; B6a: locale switcher + getStoredLocale + bidirectional key-diff test; B6b: applyI18nDom data-i18n dialect + template recursion + no-TLA wiring + $t magic; 07-12: rating color semantics green=personal / gold=VNDB + card personal-first fallback; 08-28: column-flex + auto-margin shrink-wrap grid collapse + injectFooter contract; 09-09: busy 按钮 aria-disabled 保焦点 + role=button 内嵌控件 .stop 契约 + 封面 z-index 阶梯; 09-15: 类钩子模式下 reduce 常规声明接管（!important 退役）+ 六类齐全/特异度 gotcha + motion timing scale literal 基准; 09-19: NSFW 遮罩键盘可达（role=button + 键盘揭示）+ 真 button 禁嵌 interactive——wrap 出嵌/拖拽源上移/:hover 兄弟断裂 + markdown 三标记 inline extension 恢复 + auth 探测恒走 auth/status) |
| [Type Safety](./type-safety.md) | Runtime validation in plain JS (no TypeScript) | Filled (defensive read patterns, form normalization, array/number guards) |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
