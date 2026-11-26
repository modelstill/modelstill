#!/usr/bin/env bash
set -euo pipefail

K=deploy/k8s/modelstill/kustomization.yaml
IMAGES="api website mcp"

paths_for() {
  case "$1" in
    api | website | mcp) echo "apps/$1 packages package.json bun.lock turbo.json" ;;
    *) echo "changed-apps: no path list for $1" >&2; exit 2 ;;
  esac
}

log() { echo "$*" >&2; }
to_json() { tr -s ', ' '\n' | { grep . || true; } | jq -R . | jq -sc .; }

deployed_ref=""
kfile=""
head_rev=HEAD
while [ $# -gt 0 ]; do
  case "$1" in
    --deployed-ref) deployed_ref=$2; shift 2 ;;
    --kustomization) kfile=$2; shift 2 ;;
    --head) head_rev=$2; shift 2 ;;
    *) log "changed-apps: unknown argument $1"; exit 2 ;;
  esac
done

if [ -n "${DISPATCH:-}" ]; then
  apps=$(echo "$DISPATCH" | to_json)
  log "building the dispatched list: $apps"
  echo "$apps"
  exit 0
fi

cd "$(git rev-parse --show-toplevel)"
head=$(git rev-parse --verify "${head_rev}^{commit}")

tmp=""
trap '[ -z "$tmp" ] || rm -f "$tmp"' EXIT
if [ -z "$kfile" ]; then
  kfile=$K
  if [ -n "$deployed_ref" ]; then
    tmp=$(mktemp)
    if git show "$deployed_ref:$K" > "$tmp" 2> /dev/null; then
      kfile=$tmp
      log "deployed tags read from $deployed_ref ($(git rev-parse --short "$deployed_ref"))"
    else
      log "::warning::$deployed_ref has no $K; reading the deployed tags from the checkout instead"
    fi
  fi
fi
[ -r "$kfile" ] || { log "::error::cannot read the kustomization at $kfile"; exit 1; }

if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  log "::warning::shallow checkout: deployed commits will not resolve, so every image is built (fetch-depth: 0 is required)"
fi

log "comparing what is deployed with $(git rev-parse --short "$head")"
selected=""
for image in $IMAGES; do
  line=$(grep -E "name: modelstill-${image}, " "$kfile" | head -1 || true)
  tag=$(echo "$line" | sed -nE 's#.*newTag: "?([^" }]+)"?.*#\1#p')
  read -r -a paths <<< "$(paths_for "$image")"
  if [ -z "$tag" ]; then
    reason="no image entry in the kustomization"
  elif ! [[ "$tag" =~ ^[0-9a-f]{7,40}$ ]]; then
    reason="tag $tag is not a commit SHA"
  elif ! commit=$(git rev-parse --quiet --verify "${tag}^{commit}" 2> /dev/null); then
    reason="tag $tag does not resolve to one commit in this repository"
  elif [ "$commit" = "$head" ]; then
    log "  $image: deployed at $tag, which is this commit"
    continue
  elif git merge-base --is-ancestor "$head" "$commit"; then
    log "  $image: deployed at $tag, which is newer than this commit: not built"
    continue
  else
    rc=0
    git diff --quiet "$commit" "$head" -- "${paths[@]}" || rc=$?
    if [ "$rc" = 0 ]; then
      log "  $image: deployed at $tag, nothing changed under: ${paths[*]}"
      continue
    elif [ "$rc" = 1 ]; then
      reason="changed since $tag under: ${paths[*]}"
    else
      reason="git diff against $tag failed with $rc"
    fi
  fi
  if [ "$image" = mcp ] && [ ! -f apps/mcp/ci/Dockerfile ]; then
    log "::warning::mcp: $reason, but apps/mcp/ci/Dockerfile does not exist yet: not built"
    continue
  fi
  log "  $image: BUILD ($reason)"
  selected="$selected $image"
done

if [ -z "$selected" ]; then apps='[]'; else apps=$(echo "$selected" | to_json); fi
log "building: $apps"
echo "$apps"
