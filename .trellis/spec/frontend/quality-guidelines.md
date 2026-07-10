# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Project ships with **no build step** — `public/` is served as-is via Worker Assets. `npm run lint` (ESLint over `src/**/*.js` + `public/js/**/*.js`) and `npm run test` (`node --test`) are the hard gate.

Vendor minified bundles (`public/js/vendor/*.min.js`) and `.cjs` helper scripts are **out of lint scope** by globs (`eslint.config.js` ignores `**/*.min.js`; `.cjs` does not match `public/js/**/*.js`). Do NOT lint-fix a minified bundle.

---

## Forbidden Patterns

- **Runtime third-party CDN `<script src="https://cdn...">`** in any `public/*.html`. All front-end runtime deps must be self-hosted under `public/js/vendor/`. (Supply-chain drift + availability single-point. See `alpineVersion` + `fetch:vendor` for the audit path.)
- **`{ headers: {...defaults, ...options.headers}, ...options }` merge order in `apiRequest`** — the trailing `...options` wipes the merged `headers`, losing the default `Content-Type: application/json` when a caller passes any `headers`. Always spread `...options` first, then set `headers` separately. See `public/js/api.js` `apiRequest`.
- **`Date.now()` as a unique id** for in-session counters (e.g. toast ids) — same-millisecond collisions make `removeToast` delete the wrong entry. Use a module-scoped monotonic counter (`let _seq = 0; const id = ++_seq;`) or `crypto.randomUUID()`.
- **`@click` on a non-focusable `<div>`** to open an interactive flow (e.g. a VN card). Either use a native `<button>` or add `role="button" tabindex="0"` + `@keydown.enter.space.prevent="..."` + `:aria-label`. A click-only `<div>` is invisible to keyboard users. (Tier cards already use `<button>`; index cards must add the role/keyboard attrs.)
- **Icon-only `<button>` with text content only (`&times;`, SVG).** Must carry `aria-label`. Same for toggle buttons: also `aria-expanded` + `aria-controls`.
- **Raising an `auto-fill` card grid's `minmax()` floor in a `min-width` widescreen tier without recomputing columns at the breakpoint's right edge.** Columns `N = floor((W + gap) / (min + gap))`, where W = `.container` content width (max-width 1500px, 1600px at ≥1024, minus 2×5% viewport padding, border-box). A bigger floor can DROP a column just above the breakpoint: `minmax(300px, 1fr)` at ≥1024 rendered 1024–1100px viewports as 2 giant 416px cards — fewer and larger than at 1000px (B6d root cause). When adding or tuning a wide tier, verify N and card width on BOTH sides of every breakpoint (method: per-viewport table like AC1 in task B6d's prd.md).

---

## Required Patterns

- **Self-hosted vendor with reproducible fetch script.** To add a runtime front-end lib: place the bundle under `public/js/vendor/<name>.min.js`, record its locked version as a root field in `package.json` (e.g. `alpineVersion`/`markedVersion`/`purifyVersion`), and add a `fetch:vendor` script that downloads by those versions and prints a sha256 per file for upgrade audit. The `.min.js` suffix is the lint-ignore entry — name consistently to fall under `eslint.config.js` `**/*.min.js` ignore. NOTE: `.min.js` here means "lint-ignored vendor file", not literally minified — when upstream publishes only unminified ESM (marked `lib/marked.esm.js`, dompurify `dist/purify.es.mjs`), the unminified ESM is saved AS `name.min.js`, flagged in the fetch script; renderer/callers `import` from it normally. ONE `fetch:vendor` script can pull multiple libs; alpine+marked+dompurify all live behind `public/js/vendor/fetch-vendor.cjs`.
- **`apiRequest` default header survival.** Default headers that must survive caller-supplied `options` are applied AFTER spreading `options`, never via a leading `headers` key that `...options` later overwrites.
- **Friendly error toasts via `friendlyErrorMessage(error, prefix)`.** User-facing error toasts MUST NOT leak raw technical text (`Failed to fetch` / `HTTP <status>` / server stack). Call `friendlyErrorMessage(error, prefix)` (in `api.js`): it returns `${prefix}：${friendly}` for 5xx/network/unknown (synthesized generic copy) and `${prefix}：${serverOrLocalMessage}` for 4xx/local-validation throws that already carry authored Chinese user-facing text. Premise: `src/utils.js errorResponse(message, status)` returns `{success, error}` with NO `code` field and the `error` string is already friendly — so 4xx messages are MORE precise preserved verbatim than a generic map. The raw `error.message` is only ever `console.warn`'d, never toasted unless it's a friendly authored string. `apiRequest` network failure is wrapped into `createApiError(0, {error:'网络请求失败', code:'NETWORK'})` so `Failed to fetch` never reaches a toast.
- **CSS module placement & link-order contract.** CSS lives in `public/css/` split modules; there is NO single `style.css`. `<link>` order per page is fixed: `base.css` → `forms.css` → `cards-detail.css` → page file — later files may override earlier ones (this reproduces the old single-file cascade). Rules for new styles:
  - A class used by JS-injected DOM (`layout.js` shell: progress bar / background overlay / toast / confirmDialog, `markdown.js` md-*, translation tags) or by 3+ pages goes in `base.css`. When ownership is unclear, hoist to the shared file — a page loading a few unused rules is cheap; a page missing rules for injected DOM is a silent visual break (this bit Modal and `settings-section`, both hoisted to base).
  - Breakpoints are `480 / 768 / 1024` only; responsive rules live in the SAME file as their component, not a central media block. Never reintroduce `700px`.
  - Adding a page's `<link>` set: copy the closest existing page and prune; never link a page file before the shared files.
- **Card cover images size by `aspect-ratio: 7 / 10`, never per-tier fixed heights.** `.vn-card-image` = `width: 100%` + `aspect-ratio: 7 / 10` + `object-fit: cover`: height derives from the actual column width in every tier, and the pre-load placeholder kills CLS. Works only because base.css keeps the global `img { max-width: 100%; height: auto; }` reset — any fixed `height: <px>` (base or media tier) overrides the ratio. Do not reintroduce per-tier `height` overrides: fixed heights made the crop ratio drift across tiers (0.70 / 0.57 / 0.64 before B6d) and cost one rule per tier to maintain. Grid tier semantics in `cards-detail.css`: the base `.cards-grid` rule IS the medium tier (769–1023), `min-width: 1024` is the large tier, 768/480 the phone tiers; density floors (currently 180 / 210 / 160 / 140 px) are product-tunable — when changing them, re-verify breakpoint edges per Forbidden Patterns.
- **UI copy goes through `t()` (i18n), never hardcoded string literals.** All user-visible dynamic strings in JS (toasts, status maps, validation throws, confirm dialogs, aria-labels set from JS) MUST come from `t(key, params?)` in `public/js/i18n.js`.
  - **Contract**: `t(key, params?)` — two-level key `<domain>.<name>` (domains: `common/error/status/toast/prefix/validation/confirm/time/theme/markdown`); `{name}` placeholders interpolated from `params`, missing params keep the placeholder verbatim (deliberate, to surface bugs); fallback chain `current locale → zh-CN → key itself` with per-key deduped `console.warn`. `setLocale(locale)` persists to `localStorage['locale']` then lazy-`import('./locales/<locale>.js')`, falling back to zh-CN on load failure. `initI18n()` must run in `app.js` BEFORE Alpine component registration.
  - **Dictionary carrier is a JS module, not fetched JSON**: no build step + native ESM means `import ... from './locales/zh-CN.js'` is the only way to guarantee `t()` is synchronously usable at first frame (JSON import assertions have shaky browser support; `fetch()` introduces an async race). New language = one new `locales/<locale>.js` file mirroring zh-CN's two-level key structure, zero framework change. When filling `en.js`, add a key-diff test asserting its key set ⊆ zh-CN's.
  - **Boundary — backend 4xx messages are NOT translated**: `src/utils.js errorResponse` returns authored Chinese `error` strings with no `code`; `friendlyErrorMessage` passes them through verbatim (branch 4). i18n covers frontend-authored copy only. Do not wrap backend messages in `t()`.
  - **Locale switching is refresh-effective by design**: `t()` is evaluated at call time (toast fire / render), not reactively; already-rendered text updates on reload. Do not "fix" this by making locale an Alpine reactive store without a task that needs live switching.
- **Native `confirm()` is forbidden for new flows.** Use the global `await this.$store.app.confirm({ title, message, confirmText, cancelText, danger })` Promise dialog instead (the `confirmDialog` component injected by `public/js/layout.js`). Native `confirm()` blocks the UI, is un-stylable, and is keyboard-inaccessible; the ambiguous “OK=merge / Cancel=replace” antipattern is not allowed — use two explicit text buttons via `confirmText`/`cancelText`.
- **Modals need `role="dialog" aria-modal="true" aria-labelledby`** (on the panel `.modal`, NOT the `.modal-overlay` backdrop) + a focus trap (`trapFocus` from `utils.js`) on open + focus restore on close. `@keydown.escape` lives on the panel with `.stop` so a stacked confirmDialog does NOT cascade-close the content modal behind it — never rely on `window`-level Esc listener registration order.

---

## Testing Requirements

- Gate: `npm run lint && npm run test` must exit 0 before reporting a task complete.
- New front-end bug fixes should add a minimal assertion when feasible (e.g. header merge, unique id) — either as a `node --test` case or a documented manual check in the task PRD.

---

## Code Review Checklist

Front-end changes must pass these before commit:

- `npm run lint && npm run test` exit 0.
- No runtime third-party CDN; vendor self-hosted with `fetch:vendor` reproducible (see Required Patterns for the `.min.js` naming convention covering unminified ESM bundles).
- No native `confirm()` / `alert()` in new flows — use `$store.app.confirm`.
- Clickable `<div>` has `role=button tabindex=0 + @keydown.enter.space + :aria-label`, or is a native `<button>`.
- Modal has `role=dialog aria-modal aria-labelledby` on the panel + `trapFocus` on open + focus restore on close + panel-level Esc with `.stop`.
- Toggle button has `aria-expanded`/`aria-controls`; menus have `role=menu`/`role=menuitem`.
- `aria-live` region for transient status messages (toast).
- No new hardcoded user-visible string literals in JS — dynamic UI copy goes through `t()` with the key added to `locales/zh-CN.js` (see Required Patterns; HTML static text migration is a separate pending batch).
- Shared shell elements (progress bar / background / toast / confirmDialog) come from `public/js/layout.js` `injectShell()`, NOT copy-pasted per page. Header/nav stays per-page (active nav + per-page actions differ).
- Injected shell DOM reproduces the original markup byte-for-byte (same classes + Alpine directives) to avoid style regressions.
