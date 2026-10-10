#!/usr/bin/env bash
# Demo preview environments — what Sidekick's "build the wishlist / tinder style" replies link to.
#
#   scripts/demo-previews.sh up      start pr-142 (wishlist) on :8142 and pr-143 (Tinder-style swipe) on :8143
#   scripts/demo-previews.sh down    stop them and delete their databases
#   scripts/demo-previews.sh ls
#
# Each preview is its own Compose project (own containers, network and database) running this folder's code with
# a feature flag on. For real per-branch previews built from git, use scripts/preview.sh instead.
set -euo pipefail
cd "$(dirname "$0")/.."

PREVIEWS=(
  "pr-142|8142|sidekick/wishlist-1039|wishlist"
  "pr-143|8143|sidekick/swipe-shop-1039|wishlist,swipe"
)

case "${1:-}" in
  up)
    for p in "${PREVIEWS[@]}"; do
      IFS="|" read -r label port branch features <<< "$p"
      echo "▶ $label ($features) → http://localhost:$port"
      COMPOSE_PROJECT_NAME="shoplite-$label" WEB_PORT="$port" PREVIEW_LABEL="$label" GIT_BRANCH="$branch" \
        APP_VERSION="$label" FEATURES="$features" docker compose up -d --build --wait --quiet-pull >/dev/null
    done
    echo
    echo "✅ Wishlist preview:       http://localhost:8142"
    echo "✅ Tinder-style preview:   http://localhost:8143"
    ;;
  down)
    for p in "${PREVIEWS[@]}"; do
      IFS="|" read -r label _ <<< "$p"
      docker compose -p "shoplite-$label" down -v --remove-orphans
    done
    ;;
  ls) docker compose ls --filter name=shoplite ;;
  *) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
