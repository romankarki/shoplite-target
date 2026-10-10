#!/usr/bin/env bash
# Branch preview environments with Docker Compose — one isolated stack (web + api + db) per branch.
#
#   scripts/preview.sh up   <branch> [port]   build & start <branch> → http://localhost:<port>
#   scripts/preview.sh down <branch>          stop it, delete its database and checkout
#   scripts/preview.sh ls                      list running previews
#
# Each branch is checked out into .previews/<slug> (git worktree), so main and previews never clash.
# On Windows run it from Git Bash.
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
cmd="${1:-}"; branch="${2:-}"

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
slug() { echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'; }
port_of() { docker compose -p "$1" port web 80 2>/dev/null | sed 's/.*://' || true; }
free_port() { local p=8101; while docker ps --format '{{.Ports}}' | grep -q ":$p->"; do p=$((p + 1)); done; echo "$p"; }

case "$cmd" in
  up)
    [ -n "$branch" ] || usage
    git -C "$ROOT" rev-parse --verify --quiet "$branch^{commit}" >/dev/null || { echo "No such branch/commit: $branch"; exit 1; }
    name="$(slug "$branch")"; project="shoplite-$name"; dir="$ROOT/.previews/$name"
    if [ -d "$dir" ]; then
      git -C "$dir" checkout -q --detach "$branch"
    else
      git -C "$ROOT" worktree add -q --detach "$dir" "$branch"
    fi
    port="${3:-$(port_of "$project")}"; port="${port:-$(free_port)}"
    (cd "$dir" && COMPOSE_PROJECT_NAME="$project" WEB_PORT="$port" PREVIEW_LABEL="$name" GIT_BRANCH="$branch" \
      APP_VERSION="$(git -C "$dir" rev-parse --short HEAD)" docker compose up -d --build --wait)
    echo
    echo "✅ Preview for '$branch' is up: http://localhost:$port   (project $project)"
    ;;
  down)
    [ -n "$branch" ] || usage
    name="$(slug "$branch")"
    docker compose -p "shoplite-$name" down -v --remove-orphans
    [ -d "$ROOT/.previews/$name" ] && git -C "$ROOT" worktree remove --force "$ROOT/.previews/$name"
    echo "🧹 Preview for '$branch' removed"
    ;;
  ls)
    docker compose ls --filter name=shoplite
    ;;
  *) usage ;;
esac
