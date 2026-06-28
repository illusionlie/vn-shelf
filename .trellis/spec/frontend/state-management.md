# State Management

> How state is managed in this project.

---

## Overview

Frontend is Alpine.js (MPA, no build). Global cross-page state lives in `Alpine.store('app')` registered at `alpine:init` in `public/js/app.js`; per-page state lives in Alpine.data components under `public/js/components/`. Mixins (`createTagsView`/`createDetailModal` in `components/shared.js`) spread shared logic into page components.

---

## State Categories

- **Local state** — Alpine.data component fields (e.g. `vnShelf.vnList`, `settingsPage.config`). Lifetime = page session.
- **Global state** — `Alpine.store('app')` fields: `isAdmin`, `isLoading`, `toasts`, `appearance`, plus `_appearancePromise` dedupe handle. Lifetime = page session (MPA — Store re-inits each page).
- **Server state cached client-side** — appearance via `sessionStorage` key `vn-shelf:appearance:v1`; translations via IndexedDB `vn-shelf-translations`; version-check timestamp via `localStorage` key `vn-shelf:trans:versionCheckAt`. These bridge the MPA per-page reload boundary.

---

## When to Use Global State

Promote a value to `Alpine.store('app')` when **multiple pages/components read it on the same first paint AND it round-trips the network**. B2 made appearance a Store field for exactly this reason: `theme.initBackground` and every `tagsView.loadConfig` (one per page) all hit `/api/config/appearance`, duplicating the request per page.

Pattern (from B2):
- Store owns the loader (`loadAppearance({force})`) with **Promise dedupe** (`_appearancePromise`) so concurrent first-paint callers share one request.
- **sessionStorage read-through** returns cached value immediately + fires a non-blocking background refresh.
- Mutators (e.g. `saveAppearanceConfig`) call `loadAppearance({force:true})` to invalidate after a write.
- Background refresh dispatches a `CustomEvent` so a stateless module (`theme.js`) can re-apply without holding the Store reference.

---

## Server State

Do not assume all `/api/config*` endpoints return the same fields. There are two distinct config endpoints (see `src/router.js`):

- `GET /api/config` — **authenticated**. Returns full config incl. `hasVndbApiToken`, `hasPassword`, `lastIndexTime` plus tags/background fields. Used by `settingsPage.loadConfig` to render the VNDB-token indicator (`hasVndbApiToken ? '已配置'`) and other auth-sensitive UI.
- `GET /api/config/appearance` — **public**. Returns ONLY `backgroundUrl`/`backgroundOverlay`/`backgroundBlur` + `tagsMode`/`translateTags`/`translationUrl`. Excludes all auth-only fields.

The appearance Store (`Alpine.store('app').loadAppearance`) is backed by `/api/config/appearance` ONLY. Do NOT switch `settingsPage.loadConfig` to the appearance Store — that would make `config.hasVndbApiToken` always undefined and break the token indicator (B2 learned this the hard way).

IndexedDB / localStorage bridges:`vn-shelf-translations` (translations cache) caches the `tagTranslations` store; `vn-shelf:trans:versionCheckAt` throttles `version.json` polling to 24h. Cache the IDB connection itself (module `_db`) — reopening per transaction defeats the purpose (see B2 Step 3).

---

## Common Mistakes

- **Treating all `/api/config*` as one shape.** The public appearance endpoint omits auth-only fields (`hasVndbApiToken` etc.). If a page renders auth-sensitive UI, use the authenticated `/api/config`, not the appearance Store.
- **Closing the IDB connection after each transaction.** If you cache a connection (`_db`), do NOT call `db.close()` on transaction completion — that fires `onclose`, clears the cache, and forces a reopen. Let the connection live for the page session; clear via `onclose`/`onversionchange` only.
- **Stamping a throttle timestamp AFTER the fetch.** Set the last-check timestamp BEFORE the network call, otherwise a failed fetch retries every page load.
- **Skipping Promise dedupe for first-paint concurrent loaders.** Two callers (`theme.initBackground` + `tagsView.loadConfig`) race to the same endpoint on every page nav — without an `_appearancePromise` guard you issue 2 requests.
