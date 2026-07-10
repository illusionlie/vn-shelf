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
| [Component Guidelines](./component-guidelines.md) | Component patterns, mixin composition, a11y | Filled (shared.js mixin + props/styling/a11y/mistakes) |
| [Hook Guidelines](./hook-guidelines.md) | Stateful logic extraction in Alpine.js (no React hooks) | Filled (Alpine equivalents of React hooks; mixin factories; data fetching) |
| [State Management](./state-management.md) | Local state, global store, server state | Filled (B2: appearance Store + Promise dedupe + config endpoint split + IDB cache) |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns, a11y | Filled (B1/B3/B4: vendor self-host, header merge, Date.now id, native confirm, modal role/Esc, keyboard div, friendlyError layering, code-review checklist; B5b: i18n t() contract + backend-message boundary; B5c: CSS module placement + link-order contract; B6d: card-grid density tiers + aspect-ratio cover contract; B6a: locale switcher + getStoredLocale + bidirectional key-diff test) |
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
