# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

VN Shelf is a Cloudflare Workers app for managing a visual novel shelf. The backend is an ES module Worker under `src/`, the frontend is plain HTML/CSS/JavaScript under `public/`, and persistent data lives in Cloudflare KV. There is no frontend build step, bundler, SQL database, or ORM.

## Common commands

Use npm; the repository has a `package-lock.json`.

```bash
npm ci
npm run dev
npm run lint
npm run lint:fix
npm run test
npm run tail
npm run deploy
```

- `npm run dev` starts `wrangler dev` for local Workers development.
- `npm run lint` runs ESLint over `src/**/*.js` and `public/js/**/*.js`.
- `npm run test` runs all tests with Node's built-in test runner (`node --test`).
- To run one test file, use `node --test tests/path/to/file.test.mjs`.
- CI uses stricter linting: `npx eslint "src/**/*.js" "public/js/**/*.js" --max-warnings 0`.
- CI also generates `wrangler.toml` from `wrangler.toml.example` and runs `npx wrangler deploy --dry-run --config wrangler.toml`.

## Cloudflare setup

`wrangler.toml` is local/generated configuration; `wrangler.toml.example` is the template used by CI and deploy workflows. For local setup, copy the example and replace the placeholders for the Worker name and KV namespace ID.

Required runtime bindings:

- `KV`: Cloudflare KV namespace for all JSON persistence.
- `VN_INDEX_QUEUE`: queue producer/consumer for VNDB batch indexing.
- `INDEX_START_LOCK`: Durable Object namespace for index-start locking.
- `ASSETS`: Worker Assets binding serving `./public`.

`src/index.js` is the Worker entrypoint. It serves non-API requests via `env.ASSETS.fetch(request)` and routes `/api/*` to `src/router.js`. It also exports the Queue consumer and `IndexStartLockDurableObject`.

## Backend architecture

- `src/router.js` is the central manual API router. There is no framework router.
- `src/kv.js` is the KV data access layer and owns aggregate list maintenance, tier operations, import/export behavior, and index-status reconciliation.
- `src/auth.js` handles PBKDF2 password hashing, HMAC JWT creation/verification, and HttpOnly cookie helpers.
- `src/vndb.js` calls the VNDB Kana API and normalizes VN metadata.
- `src/utils.js` contains shared utilities used by backend modules.

Important API groups:

- Auth: `/api/auth/status`, `/api/auth/init`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/verify`.
- VN reads/writes: `/api/vn`, `/api/vn/{id}`, `/api/vn/{id}/tier`, `/api/vn/tier/batch`.
- Tiers: `/api/tier`, `/api/tier/order`, `/api/tier/{id}`.
- Indexing: `/api/index/start`, `/api/index/status`.
- Config/import/export: `/api/config`, `/api/export`, `/api/import`.

Authenticated routes use `authMiddleware()` from `src/auth.js`; public reads and auth setup/login routes are intentionally available without an admin cookie.

## Data model

There is no separate schema file. KV keys and JSON structures are the schema, mainly implemented in `src/kv.js` and `src/router.js`.

Primary KV keys:

- `config:settings`: VNDB token, admin password hash, JWT secret, index timestamp, tag mode, tag translation settings.
- `vn:{id}`: full VN entry with normalized `vndb` metadata and user-managed fields such as ratings, dates, review, tags, and tier assignment.
- `vn:list`: pre-aggregated compact VN cards plus stats for fast list reads.
- `tier:list`: tier definitions, defaulting to S/A/B/C/D when missing.
- `index:status`: batch indexing state.
- `index:item:{taskId}:{vndbId}`: per-item Queue indexing result with TTL.
- `index:start-lock`: Durable Object storage key, with KV fallback behavior when the DO binding is unavailable.

When changing VN create/update/delete or tier assignment behavior, update the full `vn:{id}` entry and keep `vn:list` consistent by using the existing helpers in `src/kv.js` rather than hand-editing aggregate data.

## Queue and indexing flow

Batch VNDB indexing starts from `POST /api/index/start`. The router obtains an in-process, Durable Object, or KV fallback lock, writes `index:status`, and enqueues one message per unique VN ID to `VN_INDEX_QUEUE`. The Queue consumer in `src/index.js` fetches VNDB metadata, updates the full VN entry, records `index:item:*`, reconciles `index:status`, and rebuilds `vn:list` when the job reaches a terminal state. Cloudflare Queues are at-least-once delivery, so indexing code must remain idempotent.

## Frontend architecture

The frontend is static, browser-native JavaScript:

- `public/index.html`, `login.html`, `settings.html`, `stats.html`, and `tier.html` load Alpine.js from CDN and use components registered in `public/js/app.js`.
- `public/js/app.js` contains the shared Alpine store and page components: home shelf, login, settings, stats, and tier list.
- `public/js/api.js` is the browser API facade for `/api/*`.
- `public/js/translations.js` manages the IndexedDB-backed VNDB tag translation cache and background version checks.
- `public/js/markdown.js` renders review Markdown and escapes HTML before applying Markdown-like formatting.
- `public/css/style.css` contains global styling.

Because there is no build step, changes to frontend behavior should be made directly in `public/js/*.js` and validated in the browser through `npm run dev`.

## Tests

Tests live in `tests/` and use Node's built-in test runner with `.mjs` files. Current coverage includes KV import/rebuild and index reconciliation, Queue indexing behavior, router config/index-start paths, and Markdown security. Prefer focused tests near the relevant area, then run `npm run test` before claiming completion.

## CI and deploy

GitHub Actions run on Node 22.x. CI installs with `npm ci`, lints with zero warnings, runs tests, generates `wrangler.toml` from the example template, and performs a Wrangler dry-run deploy. Production deployment is manual via `workflow_dispatch` and uses repository secrets for the Worker name, Cloudflare API token, KV namespace, optional account ID, and optional custom domain.
