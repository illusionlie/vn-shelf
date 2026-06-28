# Directory Structure

> How frontend code is organized in this project.

---

## Overview

Front-end lives entirely under `public/` and is served as static assets (no build step). Key areas:

- `public/*.html` — one entry per page (MPA), each pulls `js/app.js` (ESM) + a `defer`red Alpine vendor.
- `public/js/` — app entry (`app.js`), API layer (`api.js`), utilities (`utils.js`), theme/translations/markdown, and `components/` page components.
- `public/js/vendor/` — **self-hosted third-party bundles** (e.g. `alpine.min.js`) plus their reproducible fetch helper (e.g. `fetch-alpine.cjs`). Committed to git, NOT installed at runtime from a CDN.

---

## Directory Layout

```
public/
├── *.html                 # MPA entries (index/login/settings/stats/tier)
├── css/style.css
└── js/
    ├── app.js             # Alpine global store + component registration
    ├── api.js             # apiRequest + API namespace wrappers
    ├── utils.js / theme.js / markdown.js / translations.js
    ├── components/        # per-page Alpine.data components
    └── vendor/            # self-hosted runtime deps (committed)
        ├── alpine.min.js
        └── fetch-alpine.cjs   # npm run fetch:vendor reproducible download
```

---

## Module Organization

<!-- How should new features be organized? -->

(To be filled by the team)

---

## Naming Conventions

<!-- File and folder naming rules -->

(To be filled by the team)

---

## Examples

<!-- Link to well-organized modules as examples -->

(To be filled by the team)
