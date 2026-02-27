#!/usr/bin/env bash
set -euo pipefail

REMOTE="origin"
PUSH="false"
YES="false"
MIRROR_DIR=""
REPLACEMENT_FILE=""
MAP_FILE=".git-secrets-map.local.json"

usage() {
  cat <<USAGE
Usage: ./scripts/safe-history-rewrite.sh [options]

Options:
  --remote <name>             Remote to rewrite (default: origin)
  --map-file <path>           Local JSON map with secrets (default: .git-secrets-map.local.json)
  --replacement-file <path>   Use explicit git-filter-repo replace-text file instead of map
  --mirror-dir <path>         Target mirror clone path for rewrite output
  --yes                       Execute rewrite steps (without this flag, script prints plan and exits)
  --push                      After successful rewrite, force-push refs and tags
  -h, --help                  Show this help

Notes:
- This script rewrites a mirror clone, never your current working tree.
- It creates a full backup mirror before rewrite.
- It never pushes unless --push is explicitly provided.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remote)
      REMOTE="$2"
      shift 2
      ;;
    --map-file)
      MAP_FILE="$2"
      shift 2
      ;;
    --replacement-file)
      REPLACEMENT_FILE="$2"
      shift 2
      ;;
    --mirror-dir)
      MIRROR_DIR="$2"
      shift 2
      ;;
    --yes)
      YES="true"
      shift
      ;;
    --push)
      PUSH="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 2
      ;;
  esac
done

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "git-filter-repo is required but not installed."
  echo "Install: python3 -m pip install --user git-filter-repo"
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

REMOTE_URL="$(git remote get-url "$REMOTE")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
if [ -z "$MIRROR_DIR" ]; then
  MIRROR_DIR="${REPO_ROOT%/*}/$(basename "$REPO_ROOT")-rewrite-${TIMESTAMP}.git"
fi
BACKUP_DIR="${MIRROR_DIR%.git}-backup-${TIMESTAMP}.git"

TMP_REPLACEMENTS=""
cleanup() {
  if [ -n "$TMP_REPLACEMENTS" ] && [ -f "$TMP_REPLACEMENTS" ]; then
    rm -f "$TMP_REPLACEMENTS"
  fi
}
trap cleanup EXIT

if [ -z "$REPLACEMENT_FILE" ]; then
  if [ ! -f "$MAP_FILE" ]; then
    echo "Map file not found: $MAP_FILE"
    echo "Either create the map file or pass --replacement-file <path>."
    exit 2
  fi

  TMP_REPLACEMENTS="$(mktemp)"
  python3 - "$MAP_FILE" "$TMP_REPLACEMENTS" <<'PY'
import json
import sys

map_file = sys.argv[1]
out_file = sys.argv[2]
parsed = json.loads(open(map_file, "r", encoding="utf-8").read())
source = parsed.get("secrets") if isinstance(parsed, dict) and isinstance(parsed.get("secrets"), dict) else parsed
if not isinstance(source, dict):
    print("No valid replacements derived from map file.", file=sys.stderr)
    sys.exit(3)

lines = []
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
    lines.append(f"{value}==><{key}>")

if not lines:
    print("No valid replacements derived from map file.", file=sys.stderr)
    sys.exit(3)

open(out_file, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY

  REPLACEMENT_FILE="$TMP_REPLACEMENTS"
fi

if [ ! -s "$REPLACEMENT_FILE" ]; then
  echo "Replacement file is empty: $REPLACEMENT_FILE"
  exit 2
fi

echo "Rewrite plan"
echo "- repo root: $REPO_ROOT"
echo "- remote: $REMOTE"
echo "- remote URL: $REMOTE_URL"
echo "- replacement file: $REPLACEMENT_FILE"
echo "- backup mirror: $BACKUP_DIR"
echo "- rewrite mirror: $MIRROR_DIR"
echo "- push after rewrite: $PUSH"

if [ "$YES" != "true" ]; then
  echo ""
  echo "Dry run complete. Re-run with --yes to execute rewrite steps."
  exit 0
fi

echo ""
echo "Cloning backup mirror..."
git clone --mirror "$REMOTE_URL" "$BACKUP_DIR"

echo "Cloning rewrite mirror..."
git clone --mirror "$REMOTE_URL" "$MIRROR_DIR"

count_hits() {
  local target_repo="$1"
  local secret_value="$2"
  git -C "$target_repo" log --all --oneline -S"$secret_value" | wc -l | tr -d ' '
}

echo ""
echo "Pre-rewrite hit counts (by replacement entries):"
while IFS= read -r LINE; do
  [ -z "$LINE" ] && continue
  case "$LINE" in
    \#*) continue ;;
  esac
  FROM="${LINE%%==>*}"
  [ "$FROM" = "$LINE" ] && continue
  HITS="$(count_hits "$MIRROR_DIR" "$FROM")"
  echo "- ${FROM:0:10}... : $HITS"
done < "$REPLACEMENT_FILE"

echo ""
echo "Running git-filter-repo..."
git -C "$MIRROR_DIR" filter-repo --replace-text "$REPLACEMENT_FILE" --force

# git-filter-repo removes remotes by default; re-add target remote for optional push.
if ! git -C "$MIRROR_DIR" remote get-url "$REMOTE" >/dev/null 2>&1; then
  git -C "$MIRROR_DIR" remote add "$REMOTE" "$REMOTE_URL"
fi

echo ""
echo "Post-rewrite hit counts (must be 0):"
FAILED=0
while IFS= read -r LINE; do
  [ -z "$LINE" ] && continue
  case "$LINE" in
    \#*) continue ;;
  esac
  FROM="${LINE%%==>*}"
  [ "$FROM" = "$LINE" ] && continue
  HITS="$(count_hits "$MIRROR_DIR" "$FROM")"
  echo "- ${FROM:0:10}... : $HITS"
  if [ "$HITS" -ne 0 ]; then
    FAILED=1
  fi
done < "$REPLACEMENT_FILE"

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "Verification failed: at least one replacement value still appears in rewritten history."
  echo "Do not push. Inspect $MIRROR_DIR and replacement inputs."
  exit 1
fi

if [ "$PUSH" = "true" ]; then
  echo ""
  echo "Force-pushing rewritten history to $REMOTE..."
  git -C "$MIRROR_DIR" push --force --all "$REMOTE"
  git -C "$MIRROR_DIR" push --force --tags "$REMOTE"
  echo "Push complete."
else
  echo ""
  echo "Rewrite completed locally. No push was performed."
  echo "Review and push manually when ready:"
  echo "  git -C '$MIRROR_DIR' push --force --all '$REMOTE'"
  echo "  git -C '$MIRROR_DIR' push --force --tags '$REMOTE'"
fi
