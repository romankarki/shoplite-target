# Postgres with ShopLite's schema + seed baked in (same image works for Compose and Kubernetes)
FROM postgres:16-alpine
COPY init/ /docker-entrypoint-initdb.d/
