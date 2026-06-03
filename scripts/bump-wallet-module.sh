#!/bin/bash

# =============================================================================
# BUMP WALLET MODULE SUBMODULE
# =============================================================================
#
# PURPOSE: Update vendor/liberdus-wallet-module in token-lock-ui and commit
#          the new submodule pointer.
#
# USAGE (from repo root):
#   ./scripts/bump-wallet-module.sh
#   ./scripts/bump-wallet-module.sh --ref c4f7059
#   ./scripts/bump-wallet-module.sh --ref main --no-commit
#
# OPTIONS:
#   --ref <tag|branch|sha>  Pin submodule to a specific ref (default: remote HEAD)
#   --no-commit             Update and stage only; do not create a commit
#   -h, --help              Show help
#
# =============================================================================

set -euo pipefail

SUBMODULE_PATH="vendor/liberdus-wallet-module"
REF=""
NO_COMMIT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="${2:?--ref requires a value}"; shift 2 ;;
    --no-commit) NO_COMMIT=true; shift ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--ref <tag|branch|sha>] [--no-commit]"
      exit 0
      ;;
    *) echo "Error: unknown option: $1"; exit 1 ;;
  esac
done

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$SUBMODULE_PATH" ]; then
  echo "Error: submodule path not found: $SUBMODULE_PATH"
  exit 1
fi

staged_outside_submodule="$(git diff --cached --name-only | grep -v -E "^${SUBMODULE_PATH}(/|$)" || true)"
if [ -n "$staged_outside_submodule" ]; then
  echo "Error: staged changes exist outside $SUBMODULE_PATH"
  echo "$staged_outside_submodule"
  exit 1
fi

git submodule update --init --recursive "$SUBMODULE_PATH"

if [ -n "$REF" ]; then
  git -C "$SUBMODULE_PATH" fetch origin --tags
  git -C "$SUBMODULE_PATH" checkout "$REF"
else
  git submodule update --remote "$SUBMODULE_PATH"
fi

if [ ! -f "$SUBMODULE_PATH/index.js" ]; then
  echo "Error: $SUBMODULE_PATH/index.js not found after update"
  exit 1
fi

git add "$SUBMODULE_PATH"

if git diff --cached --quiet -- "$SUBMODULE_PATH"; then
  echo "No submodule pointer change to commit."
  exit 0
fi

if [ "$NO_COMMIT" = true ]; then
  echo "Submodule change staged (--no-commit)."
  exit 0
fi

NEW_SHA="$(git -C "$SUBMODULE_PATH" rev-parse HEAD)"
COMMIT_MSG="chore: bump liberdus-wallet-module submodule to ${NEW_SHA:0:7}"
git commit -m "$COMMIT_MSG" -- "$SUBMODULE_PATH"
echo "$COMMIT_MSG"
