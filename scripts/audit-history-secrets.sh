#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MAP_FILE="${1:-.git-secrets-map.local.json}"
if [ ! -f "$MAP_FILE" ]; then
  echo "Secret map not found: $MAP_FILE"
  echo "Create it from .git-secrets-map.example.json first."
  exit 2
fi

extract_entries() {
  python3 - "$MAP_FILE" <<'PY'
import json
import sys

path = sys.argv[1]
parsed = json.loads(open(path, "r", encoding="utf-8").read())
source = parsed.get("secrets") if isinstance(parsed, dict) and isinstance(parsed.get("secrets"), dict) else parsed
if not isinstance(source, dict):
    sys.exit(0)

for raw_key, raw_value in source.items():
    if not isinstance(raw_value, str):
        continue
    key = str(raw_key).strip()
    if key.startswith("<"):
        key = key[1:]
    if key.endswith(">"):
        key = key[:-1]
    key = key.strip()
    value = raw_value.strip()
    if not key or not value:
        continue
    if value.startswith("replace-with-your-") or value.startswith("0xreplace-with-your-"):
        continue
    print(f"{key}\t{value}")
PY
}

HAS_BRANCH_OR_HEAD_HITS=0
HAS_PULL_REF_HITS=0

has_pull_refs() {
  [ -n "$(git for-each-ref --count=1 --format='%(refname)' refs/pull 2>/dev/null || true)" ]
}

count_hits() {
  local mode="$1"
  local value="$2"
  case "$mode" in
    head)
      git grep -F -n -- "$value" HEAD -- . 2>/dev/null | wc -l | tr -d ' '
      ;;
    branches)
      git log --branches --oneline -S"$value" 2>/dev/null | wc -l | tr -d ' '
      ;;
    pull)
      git log refs/pull --oneline -S"$value" 2>/dev/null | wc -l | tr -d ' '
      ;;
    *)
      echo "invalid-mode"
      return 2
      ;;
  esac
}

printf "%-34s %-10s %-14s %-13s\n" "SECRET_KEY" "HEAD_HITS" "BRANCH_HITS" "PULL_REF_HITS"
printf "%-34s %-10s %-14s %-13s\n" "----------------------------------" "----------" "--------------" "-------------"

while IFS=$'\t' read -r KEY VALUE; do
  [ -z "${KEY:-}" ] && continue
  [ -z "${VALUE:-}" ] && continue

  HEAD_HITS="$(count_hits head "$VALUE")"
  BRANCH_HITS="$(count_hits branches "$VALUE")"
  PULL_HITS="0"
  if has_pull_refs; then
    PULL_HITS="$(count_hits pull "$VALUE")"
  fi

  printf "%-34s %-10s %-14s %-13s\n" "$KEY" "$HEAD_HITS" "$BRANCH_HITS" "$PULL_HITS"

  if [ "$HEAD_HITS" -gt 0 ] || [ "$BRANCH_HITS" -gt 0 ]; then
    HAS_BRANCH_OR_HEAD_HITS=1
  fi
  if [ "$PULL_HITS" -gt 0 ]; then
    HAS_PULL_REF_HITS=1
  fi
done < <(extract_entries)

if [ "$HAS_BRANCH_OR_HEAD_HITS" -eq 1 ]; then
  echo ""
  echo "One or more configured secrets are present in HEAD and/or branch history."
  exit 1
fi

if [ "$HAS_PULL_REF_HITS" -eq 1 ]; then
  echo ""
  echo "No hits in HEAD/branches, but secret values were found in refs/pull/*."
  echo "These refs are provider-managed on GitHub and may require GitHub Support cleanup."
  exit 3
fi

echo ""
echo "No configured secret values detected in HEAD, branch history, or refs/pull."
