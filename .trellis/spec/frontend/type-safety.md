# Type Safety

> Runtime type safety patterns in this project.

---

## Overview

This project is **plain ES Modules JavaScript, no TypeScript, no build step**. `public/js/**/*.js` runs directly in the browser via Worker Assets. There is no compile-time type checker; type safety is **runtime validation + defensive defaults + narrow API contracts**, documented here so AI agents and contributors match the established pattern rather than inventing new ones.

No plans to adopt TS: the MPA + no-build + Alpine.js stack is intentionally lightweight. If that decision changes, replace this file.

---

## Type Organization

- **No `.d.ts`, no `@types/`, no JSDoc-type-enforced tooling.** JSDoc `@param` / `@returns` are used for human-readable hints (see `utils.js` `withLoading`, `trapFocus`, `api.js` `friendlyErrorMessage`) but are NOT type-checked.
- **API response shapes** are the contract surface. See `AGENTS.md` «数据结构» section for the canonical VN entry / list item / tier list shapes — those are the authoritative field names; do not rename client-side.
- **Defensive read patterns** are how "types" are enforced at runtime:
  ```js
  const playTimeHours = Number.isFinite(Number(vn.user?.playTimeHours))
    && Number(vn.user?.playTimeHours) >= 0
      ? Math.floor(Number(vn.user?.playTimeHours))
      : 0;
  ```
  (`vnShelf.js openEdit` — normalize before storing into `editForm`.) Mirror this for any user-supplied or server-supplied number that feeds into the UI.

---

## Validation

- **Server is the source of truth.** The frontend trusts API field names from `AGENTS.md` but never trusts values: numbers are `Number.isFinite`-checked, arrays are `Array.isArray`-checked, optional object paths use `?.` and `|| defaultValue`.
- **Form input normalization** happens at write boundary: `vnShelf.js saveEdit` calls `normalizePlayTimeInput` which `throw new Error('<friendly message>')` for invalid input; the catch site shows the thrown friendly message directly (it is NOT a server error — see `friendlyErrorMessage` rule in `quality-guidelines.md`). Validation throws are authored in Chinese, user-facing.
- **Structural import validation** (e.g. `settingsPage.importData`) checks `data.entries` is an array and `JSON.parse` errors are caught into a friendly "无效的导入文件格式" toast rather than surfacing `Unexpected token...`.
- **No runtime schema library** (Zod/Yup/io-ts). The payload is small and stable; inline guards suffice. If a payload grows complex (e.g. import payload with nested tierList), add a focused validator function, not a dependency.

---

## Common Patterns

- **Default-on-missing**: `vn.user?.titleCn || ''`, `vn.developers?.[0] || ''`, `res.data || []`. The only place `res.data || res` is tolerated is the documented `statsPage.js` envelope-inconsistency fallback (A3 debt — flagged for cleanup in B5).
- **`Number.isFinite(Number(x))`** before arithmetic — see `formatUserPlayTime`, `playTimeHours` normalization, `rating?.toFixed(2)`.
- **`Array.isArray(x)`** before `.map/.filter/.length` — see `getDisplayTags` (`Array.isArray(vn?.user?.tags)`), `loadTiers` (`Array.isArray(res.data)`).
- **`try { JSON.parse } catch`** for any user-file ingestion; the catch is user-facing.
- **Date parsing guard**: `Number.isNaN(date.getTime()) ? fallback : date.toLocaleString(...)` — see `settingsPage.formatDate` / `formatDateTime`.
- **Conditional rendering via `x-show` + `?.`** keeps missing fields from throwing in Alpine expressions: `x-show="vn.imageNsfw && !showNsfw"` etc.

---

## Forbidden Patterns

- **Blind `JSON.parse` without try/catch** when input originates from a user file or external string — leaks `Unexpected token` stack to a toast.
- **`Number(x)` then arithmetic without `Number.isFinite` check** — NaN propagation corrupts display (e.g. rating shows "NaN").
- **`x.map` / `x.length` without `Array.isArray(x)`** when `x` comes from an API response — a `null` payload crashes `x-template` rendering silently.
- **Toasting raw `error.message` for server errors** — see `friendlyErrorMessage` rule in `quality-guidelines.md`. Only locally-thrown friendly strings may be toasted directly.
- **`as any`-style "trust me" casts** don't exist in JS, but the equivalent — assuming a field exists without `?.` — is forbidden for API-derived data. Use `?.` and a default.
- **Renaming API field names client-side.** The backend envelope (`AGENTS.md` «数据结构») is the contract; if a field is missing, fix the backend or default-defensively, never rename.