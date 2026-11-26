#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

join() {
  local IFS=""
  printf '%s' "$*"
}

patterns=(
  "$(join jobs pipe)"
  "$(join chi- jobs)"
  "$(join adapters- jobs)"
  "/Users/[a-z]"
  "Desktop/projects"
  "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+:22"
  "[a-z0-9]--[a-z0-9-]+\\.modal\\.run"
  "modelstill\\.dev"
)

failed=0
for pattern in "${patterns[@]}"; do
  if hits=$(git grep -nIiE "$pattern" -- . ':!bun.lock' ':!*.lock' ':!apps/docs/test/content-rules.test.ts' ':!.github/scripts/no-internal-names.sh'); then
    echo "Internal name or path matched /$pattern/:"
    echo "$hits" | cut -c1-200
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "Remove these before merging: private names, hosts and paths do not belong in this repository."
  exit 1
fi
echo "No internal names found."
