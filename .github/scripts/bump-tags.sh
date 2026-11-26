#!/usr/bin/env bash
set -euo pipefail

{
: "${SHA:?SHA is the full commit the images were built from}"
: "${OWNER:?OWNER is the lowercase GHCR namespace the images were pushed to}"
built=${1:-built}
k=deploy/k8s/modelstill/kustomization.yaml
tag=${SHA:0:7}
out=${GITHUB_OUTPUT:-/dev/null}
attempts=${BUMP_ATTEMPTS:-5}

apps=$(find "$built" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; 2> /dev/null | sort | tr '\n' ' ' || true)
[ -n "$apps" ] || { echo "nothing was built"; exit 0; }
echo "built: $apps"

git config user.name "modelstill-deploy[bot]"
git config user.email "deploy@users.noreply.github.com"
scratch=$(mktemp)
trap 'rm -f "$scratch"' EXIT

attempt=1
while :; do
  git fetch --quiet origin main
  git reset --quiet --hard FETCH_HEAD
  bumped=""
  superseded=""
  for app in $apps; do
    cur=$(sed -nE "s#.*name: modelstill-${app}, .*newTag: \"?([^\" }]+)\"?.*#\1#p" "$k" | head -1)
    if [ "$cur" != "$tag" ] && [[ "$cur" =~ ^[0-9a-f]{7,40}$ ]] \
      && cur_commit=$(git rev-parse --quiet --verify "${cur}^{commit}" 2> /dev/null) \
      && [ "$cur_commit" != "$SHA" ] \
      && git merge-base --is-ancestor "$SHA" "$cur_commit" 2> /dev/null; then
      echo "::warning::$app stays at $cur, which already contains $tag: not moved backwards"
      superseded="$superseded $app"
      continue
    fi
    sed -E "s#(name: modelstill-${app}, newName: )[^,]+, newTag: [^ }]+#\1ghcr.io/${OWNER}/modelstill-${app}, newTag: \"${tag}\"#" "$k" > "$scratch"
    cat "$scratch" > "$k"
    bumped="$bumped $app"
  done
  bumped=${bumped# }
  superseded=${superseded# }
  if git diff --quiet -- "$k"; then
    echo "no tag changed"
    break
  fi
  git add "$k"
  git commit --quiet -m "deploy(k8s): ${bumped} -> ${tag}"
  if git push --quiet origin HEAD:main; then
    git log --oneline -1
    break
  fi
  if [ "$attempt" -ge "$attempts" ]; then
    echo "::error::main moved under every one of $attempts attempts to push the tag bump: nothing was published"
    exit 1
  fi
  echo "::warning::main moved while the tags were being bumped; starting over from its new tip ($attempt/$attempts)"
  attempt=$((attempt + 1))
  sleep "${BUMP_RETRY_SLEEP:-5}"
done

{
  echo "bumped=$bumped"
  echo "superseded=$superseded"
} >> "$out"
echo "bumped: ${bumped:-<nothing>}; left on a newer tag: ${superseded:-<nothing>}"
exit 0
}
