#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
hook=.claude/hooks/block-slash-comments.mjs
failed=0

while IFS= read -r file; do
  if ! jq -n --arg p "/$file" --rawfile c "$file" '{tool_input: {file_path: $p, content: $c}}' \
    | node "$hook" 2> /dev/null; then
    echo "::error file=$file::comment in TS/JS (AGENTS.md, Code style)"
    failed=1
  fi
done < <(git ls-files '*.ts' '*.tsx' '*.mts' '*.cts' '*.js' '*.jsx' '*.mjs' '*.cjs' | grep -v '/vendor/' | grep -v '^\.claude/' || true)

while IFS= read -r file; do
  if awk 'NR == 1 && /^#!/ { next } /^[[:space:]]*#/ { found = 1; print FILENAME ":" NR ": " $0 } END { exit found ? 1 : 0 }' "$file"; then
    continue
  fi
  echo "::error file=$file::comment in a deploy, CI or Dockerfile (AGENTS.md, Code style)"
  failed=1
done < <(git ls-files 'deploy/k8s/**' '.github/workflows/**' '.github/actions/**' '.github/scripts/**' 'docs/examples/**' 'apps/*/ci/**' || true)

if [ "$failed" = 1 ]; then
  echo "comments found: reasons belong in docs/decisions or docs/runbooks"
  exit 1
fi
echo "no comments found"
