# Hook Guidelines

> How stateful logic is extracted and reused in this project.

---

## Overview

This project uses **Alpine.js (MPA, no build)**, not React. There is no `use*` hook concept, no rule-of-hooks, no hook linter. "Hook-style" reuse here means **extracting stateful logic into a factory function** that returns an Alpine-compatible object, spread into a page component or registered as a Store. Equivalent concerns (data fetching, derived state, side-effect cleanup) all map to Alpine primitives documented below.

---

## Custom Hook → Alpine Equivalents

When you'd write a `useX()` hook in React, do this instead:

| React concept | Alpine.js equivalent in this project |
|---|---|
| `useState` / `useReducer` | Component field on the factory object (`field: value`), mutated directly; Alpine reactivity drives the DOM |
| `useEffect(() => {}, [deps])` | `init()` (runs once on mount) for setup; `this.$watch('field', cb)` for reactive deep-watch with Alpine's own diffing |
| `useMemo` | A plain getter or `get` accessor on the object (re-computed on read); Alpine evaluates `x-text`/`:class` reactively |
| `useCallback` | Just a method on the object — methods are stable by reference on the factory instance |
| `useRef` | A mutable field prefixed `_` (e.g. `_trapRelease`, `_indexStatusPollTimer`, `_beforeUnloadHandler`) — NOT reactive |
| Custom `useX()` hook | A **mixin factory** in `shared.js` (`createTagsView()` / `createDetailModal()`) or a helper module (`utils.js`) |
| Context / Provider | `Alpine.store('app', {...})` registered at `alpine:init` in `app.js` |

---

## Custom Hook Patterns (Mixin Factories)

Stateful reusable logic lives as factory functions returning plain objects, spread into page components via `...createTagsView()` / `...createDetailModal()`. See `component-guidelines.md` "Component Structure" for the canonical pattern and the historical drift bug it prevents.

Rules:
- Mixin method `this` resolves to the host Alpine component instance at call time — it may use `this.$store.app`, `this.$nextTick`, `this.$watch`, `this.$refs`.
- Spread order matters: later overrides earlier. When composing two mixins with a name clash, the page component's own method (written after the spreads) wins.
- For teardown, MPA reloads handle cleanup implicitly per page; for in-page component rebuild, guard with `_initialized` to avoid duplicate listeners (see `setupTranslationsRefresh` in `shared.js`).

---

## Data Fetching

- All API calls go through `apiRequest(endpoint, { method, body, headers })` in `public/js/api.js`, never direct `fetch` from a component. `apiRequest` enforces JSON Content-Type, wraps network failures into `createApiError(0, {error:'网络请求失败', code:'NETWORK'})`, and unwraps the response.
- Call sites use the typed namespace wrappers (`authAPI`, `vnAPI`, `tierAPI`, `configAPI`, `indexAPI`, `dataAPI`) exported from `api.js` — do not hand-build endpoints in components.
- Loading state: use `withLoading(ctx, asyncFn, { successMsg, errorPrefix })` (`utils.js`) for the canonical `isLoading` flip + try/catch + friendly toast wrapper (codified in B2). Do not re-implement this pattern per method.
- Errors: pass the caught error through `friendlyErrorMessage(error, prefix)` (`api.js`) before toasting — never toast raw `error.message` (codified in B4, see `quality-guidelines.md`).
- Cross-cutting server state (e.g. appearance config) belongs in `Alpine.store('app')` with Promise dedupe + sessionStorage read-through (`loadAppearance`, B2). Do not re-fetch per-page in a component; read from the Store.

---

## Naming Conventions

- Component factories: lowercase camelCase noun matching the page (`vnShelf()`, `tierlistPage()`, `settingsPage()`, `statsPage()`, `loginPage()`, `confirmDialog()`). Registered via `Alpine.data('vnShelf', vnShelf)` in `app.js`.
- Mixin factories: `create<ViewOrModal>()` returning an object (`createTagsView()`, `createDetailModal()`).
- Internal (non-reactive) fields: underscore prefix (`_initialized`, `_trapRelease`, `_lastFocus`, `_confirmDialog`).
- API namespaces: `<domain>API` (`authAPI`, `vnAPI`, `tierAPI`, `configAPI`, `indexAPI`, `dataAPI`).

---

## Common Mistakes

- **Calling `fetch` directly from a component.** Bypasses `apiRequest`'s header-default + network-fail-wrapping + envelope unwrap. Always go through the namespace wrappers.
- **Re-implementing the isLoading/try-catch/toast pattern.** Use `withLoading` — per-method hand-rolled versions drift (B2 found 4 near-identical copies in `settingsPage`).
- **Per-page re-fetching shared server state.** Appearance lives in the Store (B2). A component reading appearance should call `this.$store.app.loadAppearance()`, not `configAPI.getAppearance()`.
- **Naming a component helper `GetXxx` while another page calls the same concept `fetchXxx` / `loadXxx`.** Historical drift bug (B0-era). Standardize on `loadXxx` for server reads (`loadVNList`, `loadTiers`, `loadConfig`).
- **Mutating `_initialized`-guarded init** without the guard — `init()` can fire twice under Alpine + bfcache; guard it.