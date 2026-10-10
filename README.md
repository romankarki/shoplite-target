# ShopLite

The demo e-commerce app that Sidekick operates: browse, search, cart, checkout, order history and a
"report a problem / request a feature" widget. Same design as the Sidekick prototype (light + dark).

```
browser ──► web (nginx: static UI, proxies /api) ──► api (FastAPI, :8000, /metrics) ──► db (Postgres 16)
```

| Folder | What |
|---|---|
| `web/` | nginx + vanilla HTML/CSS/JS UI (`public/`), `/api/*` proxied to the api service |
| `api/` | FastAPI: products, cart, checkout, orders, feedback; Prometheus metrics on `/metrics` |
| `db/` | Postgres image with schema + seed baked in (`init/*.sql`, run on first start) |
| `k8s/base/` | Kustomize manifests (db, api, web) — namespace-agnostic |
| `scripts/preview.sh` | per-branch preview stacks on Docker Compose |
| `scripts/k8s-preview.sh` | per-branch preview namespaces on Kubernetes |

## Run it
```bash
docker compose up -d --build        # → http://localhost:8080
docker compose logs -f api
docker compose down                 # add -v to wipe the database
```
API docs: http://localhost:8080/api/docs

## Branch previews (what Sidekick uses for "PR + preview link")
Requires the folder to be a git repo (`git init && git add -A && git commit -m "ShopLite"`). Run from Git Bash:
```bash
scripts/preview.sh up sidekick/wishlist-1039      # → ✅ Preview … http://localhost:8101
scripts/preview.sh ls
scripts/preview.sh down sidekick/wishlist-1039
```
Each branch is checked out into `.previews/<slug>` (git worktree) and started as its own Compose project
(`shoplite-<slug>`): separate containers, network, **database** and port (8101, 8102, …). The UI shows a
purple "Preview environment" banner with the branch name; `/api/health` reports branch + commit.

## Feature flags & demo previews
`FEATURES` (comma-separated) turns on features per deployment — `/api/health` reports them and `web/public/features.js` reacts:
- `wishlist` — ♥ on products + wishlist drawer (`/api/wishlist`, table `wishlist_items`)
- `swipe` — Tinder-style Discover deck: → wishlist · ← skip · ↑ cart (implies wishlist)

```bash
bash scripts/demo-previews.sh up     # pr-142 (wishlist) → :8142 · pr-143 (wishlist,swipe) → :8143
bash scripts/demo-previews.sh down
```
These are what Sidekick's "build the wishlist / tinder style" answers link to. Main (:8080) runs with no flags.

## Kubernetes
```bash
kubectl apply -k k8s/base                                        # into the current namespace
scripts/k8s-preview.sh up sidekick/wishlist-1039                  # Docker Desktop K8s: local images
scripts/k8s-preview.sh up sidekick/wishlist-1039 <ecr-registry>   # EKS: builds + pushes to ECR
kubectl -n pr-sidekick-wishlist-1039 port-forward svc/web 8080:80
scripts/k8s-preview.sh down sidekick/wishlist-1039
```
Each branch gets namespace `pr-<slug>`. The db uses `emptyDir` (throwaway, right for previews) — use a PVC or RDS
for long-lived environments. For a local cluster, enable Kubernetes in Docker Desktop settings.

## API
All cart/order calls take an anonymous `X-Customer-Id: <uuid>` header (the UI keeps one in localStorage).

| Method | Path | |
|---|---|---|
| GET | `/api/health` | status, version (commit), branch, preview label |
| GET | `/api/products?q=` | catalog — sent with `Cache-Control: public, max-age=300` so a CDN (Akamai) can cache it |
| GET | `/api/products/{id}` | one product |
| GET | `/api/cart` | cart with line totals |
| PUT | `/api/cart/items/{id}` | `{"qty": n}` — set quantity (0 removes), checks stock |
| POST | `/api/checkout` | `{"email": …}` — transactional: locks rows, checks stock, creates order, decrements stock |
| GET | `/api/orders` | last 20 orders with items |
| POST | `/api/feedback` | `{"kind": "bug"\|"feature", "message", "page"}` → `FB-0001`; forwarded to `FEEDBACK_WEBHOOK_URL` if set |
| GET | `/metrics` | Prometheus: `http_request_duration_seconds{route,status}`, `shoplite_orders_total` (api container only) |

## Config (`.env`, see `.env.example`)
`WEB_PORT`, `DB_PASSWORD`, `APP_VERSION`, `GIT_BRANCH`, `PREVIEW_LABEL`, `FEEDBACK_WEBHOOK_URL`.

## Planting demo bugs later
Keep them as real commits on a branch so Sidekick finds them in the git history, e.g. the cache-header regression:
change `Cache-Control` in `api/app/main.py` (`list_products`) to `no-store`.
