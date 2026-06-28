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

---

## Required Patterns

- **Self-hosted vendor with reproducible fetch script.** To add a runtime front-end lib: place the minified bundle under `public/js/vendor/<name>.min.js`, record its locked version as a root field in `package.json` (e.g. `alpineVersion`), and add a `fetch:vendor`-style script that re-downloads by that version and prints a sha256 for upgrade audit.
- **`apiRequest` default header survival.** Default headers that must survive caller-supplied `options` are applied AFTER spreading `options`, never via a leading `headers` key that `...options` later overwrites.

---

## Testing Requirements

- Gate: `npm run lint && npm run test` must exit 0 before reporting a task complete.
- New front-end bug fixes should add a minimal assertion when feasible (e.g. header merge, unique id) — either as a `node --test` case or a documented manual check in the task PRD.

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
