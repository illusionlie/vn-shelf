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
├── css/                   # split CSS modules, per-page <link> (no single style.css)
│   ├── base.css           # variables/dark-mode/reset/header/nav/buttons/toast/modal/
│   │                      # settings-section/empty/loading — everything injected shells
│   │                      # (layout.js) or 3+ pages need; ALWAYS linked first
│   ├── forms.css          # form-* + radio/checkbox (index/login/settings/tier)
│   ├── cards-detail.css   # vn-card/modal-detail/markdown/nsfw (index + tier)
│   └── tier|stats|login|settings.css  # page-specific sections
└── js/
    ├── app.js             # Alpine global store + component registration (calls initI18n() first)
    ├── api.js             # apiRequest + API namespace wrappers
    ├── i18n.js            # UI i18n: t()/setLocale()/getLocale()/initI18n()
    ├── locales/           # UI dictionaries as JS modules (zh-CN.js full, en.js placeholder)
    ├── utils.js / theme.js / markdown.js / translations.js
    │                      # NOTE: translations.js = VNDB tags domain translation (IndexedDB + remote dict),
    │                      #       a SEPARATE system from i18n.js — never merge them
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
