#!/usr/bin/env bash
# Branch previews on Kubernetes — each branch gets its own namespace "pr-<slug>".
#
#   scripts/k8s-preview.sh up   <branch> [registry]   build images for <branch>, deploy to namespace pr-<slug>
#   scripts/k8s-preview.sh down <branch>              delete the namespace
#
# registry: e.g. 123456789012.dkr.ecr.ap-south-1.amazonaws.com/shoplite  (images are pushed there).
# Leave it empty for Docker Desktop's built-in Kubernetes — local images are used directly.
# Then:  kubectl -n pr-<slug> port-forward svc/web 8080:80   (or add an Ingress on EKS)
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
cmd="${1:-}"; branch="${2:-}"; registry="${3:-}"

usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
slug() { echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'; }

case "$cmd" in
  up)
    [ -n "$branch" ] || usage
    name="$(slug "$branch")"; ns="pr-${name#pr-}"; dir="$ROOT/.previews/$name"
    if [ -d "$dir" ]; then git -C "$dir" checkout -q --detach "$branch"; else git -C "$ROOT" worktree add -q --detach "$dir" "$branch"; fi
    tag="$(git -C "$dir" rev-parse --short HEAD)"
    prefix="${registry:+$registry/}"

    for svc in db api web; do
      docker build -q -t "${prefix}shoplite-$svc:$tag" "$dir/$svc"
      if [ -n "$registry" ]; then docker push -q "${prefix}shoplite-$svc:$tag"; fi
    done

    overlay="$(mktemp -d)"
    cp -r "$dir/k8s/base" "$overlay/base"
    cat > "$overlay/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: $ns
resources: [base]
configMapGenerator:
  - name: shoplite-config
    behavior: merge
    literals: [APP_VERSION=$tag, GIT_BRANCH=$branch, PREVIEW_LABEL=$ns]
images:
  - { name: shoplite-db,  newName: ${prefix}shoplite-db,  newTag: "$tag" }
  - { name: shoplite-api, newName: ${prefix}shoplite-api, newTag: "$tag" }
  - { name: shoplite-web, newName: ${prefix}shoplite-web, newTag: "$tag" }
EOF
    kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f -
    kubectl apply -k "$overlay"
    kubectl -n "$ns" rollout status deploy/db deploy/api deploy/web --timeout=180s
    rm -rf "$overlay"
    echo
    echo "✅ '$branch' deployed to namespace $ns"
    echo "   kubectl -n $ns port-forward svc/web 8080:80   → http://localhost:8080"
    ;;
  down)
    [ -n "$branch" ] || usage
    name="$(slug "$branch")"
    kubectl delete namespace "pr-${name#pr-}" --wait=false
    ;;
  *) usage ;;
esac
