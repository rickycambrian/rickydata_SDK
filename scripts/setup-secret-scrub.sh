#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "python is required but not found in PATH."
  echo "Install Python 3 or set PYTHON_BIN to your interpreter path."
  exit 2
fi

# Detect any configured hooks path (local or global) so we can chain it.
EXISTING_HOOKS_PATH="$(git config --get core.hooksPath || true)"
if [ -n "$EXISTING_HOOKS_PATH" ] && [ "$EXISTING_HOOKS_PATH" != ".githooks" ]; then
  mkdir -p .githooks
  printf "%s" "$EXISTING_HOOKS_PATH" > .githooks/.previous-hooks-path
  echo "Detected existing core.hooksPath='$EXISTING_HOOKS_PATH' and configured chaining via .githooks/.previous-hooks-path."
fi

git config filter.secretscrub.clean "$PYTHON_BIN scripts/secret-filter.py clean"
git config filter.secretscrub.smudge "$PYTHON_BIN scripts/secret-filter.py smudge"
git config filter.secretscrub.required true

git config core.hooksPath .githooks

if [ ! -f .git-secrets-map.local.json ]; then
  cp .git-secrets-map.example.json .git-secrets-map.local.json
  echo "Created .git-secrets-map.local.json from template. Fill in real values locally."
fi

echo "Secret scrub configured."
echo "- Git clean/smudge filter: secretscrub"
echo "- Git hooks path: .githooks"
echo "- Local map file: .git-secrets-map.local.json"
if [ -f .githooks/.previous-hooks-path ]; then
  echo "- Previous hooks path is chained via .githooks/.previous-hooks-path"
fi
echo ""
echo "Next:"
echo "1) Edit .git-secrets-map.local.json with your real secrets"
echo "2) Re-checkout files you want hydrated: git checkout -- ."
