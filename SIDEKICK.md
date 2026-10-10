# ShopLite: brief for Sidekick

Sidekick (the ops/dev agent) loads this file into its context on every turn. Keep it short, accurate and current.

## Stack
- **Web:** static, **vanilla HTML/CSS/JS** (no React, no build step, no npm), served by nginx (`web/nginx.conf`), which proxies `/api/*` to the API.
- **API:** Python **FastAPI** in a single file, `api/app/main.py`, with Postgres 16 (psycopg). Prometheus metrics are on `/metrics`.
- **DB:** schema and seed data in `db/init/001_schema.sql` and `002_seed.sql`. Tables added later are created on API startup in `main.py`, e.g. `wishlist_items`.
- **Deploy:**
  - Docker Compose (`docker-compose.yml`) for prod on Akamai Cloud.
  - Kubernetes manifests (`k8s/base/`) for PR previews on Akamai LKE.
  - Every PR gets a live preview at `https://pr-<n>.…`.

## File map
| Path | What |
|---|---|
| `web/public/index.html` | Page shell: header (logo, search, Orders, Cart), hero banner, product grid, cart drawer + checkout form, orders drawer, report modal |
| `web/public/app.js` | Catalog, search, cart, checkout, orders, feedback; calls `window.onFeatures(features)` after `/api/health` |
| `web/public/features.js` | Everything behind feature flags (wishlist, swipe deck) |
| `web/public/styles.css` | All styles; light/dark via CSS variables |
| `api/app/main.py` | All endpoints: products, cart, checkout, orders, wishlist, feedback, health, metrics |
| `docker-compose.yml` | Prod/local stack; `FEATURES` default for prod |
| `k8s/base/kustomization.yaml` | ConfigMap `shoplite-config` (incl. `FEATURES`) for Kubernetes previews |

## Feature flags (already implemented: turn on, don't rebuild)
`FEATURES` is a comma-separated list read by the API. `/api/health` reports it, and `features.js` reacts to it.

- **`wishlist`:** a ♥ on every product, a wishlist drawer, and `/api/wishlist` (GET, PUT `/{id}`, DELETE `/{id}`).
- **`swipe`:** a Tinder-style "Discover" card deck (swipe → wishlist, ← skip, ↑ cart). It implies `wishlist`.

**To enable a feature,** set it in **both** places in one PR:
1. `docker-compose.yml`: `FEATURES: ${FEATURES:-wishlist,swipe}` (prod default)
2. `k8s/base/kustomization.yaml`: the `FEATURES=…` literal (so the PR's LKE preview shows it)

## Conventions for changes
- **Keep it small.** Change existing files with exact find/replace edits. Put new UI behaviour in `features.js` behind a flag when it's experimental.
- **Match the code style:**
  - vanilla DOM (`$("#id")` helper in `app.js`);
  - CSS variables from `styles.css`;
  - FastAPI handlers with plain SQL.
- **No new dependencies** unless asked.
- **User-visible text** lives in `index.html` (static) or `app.js` (dynamic, e.g. the Checkout button label is reset in `app.js` after an order).
