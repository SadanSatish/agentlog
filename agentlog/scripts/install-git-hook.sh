#!/usr/bin/env bash
# install-git-hook.sh
#
# Run this from inside the repo you want AgentLog to watch:
#   bash /path/to/agentlog/scripts/install-git-hook.sh
#
# It copies record-commit.mjs into .agentlog/ in that repo and wires up a
# post-commit hook that calls it. Safe to re-run.

set -euo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Not inside a git repo. cd into the repo you want AgentLog to watch and re-run." >&2
  exit 1
}

mkdir -p "$REPO_ROOT/.agentlog"
cp "$THIS_DIR/record-commit.mjs" "$REPO_ROOT/.agentlog/record-commit.mjs"

HOOKS_DIR="$REPO_ROOT/.git/hooks"
mkdir -p "$HOOKS_DIR"
cp "$THIS_DIR/git-hooks/post-commit" "$HOOKS_DIR/post-commit"
chmod +x "$HOOKS_DIR/post-commit"

echo "Installed AgentLog post-commit hook in $REPO_ROOT"
echo "Commits will be logged to \$AGENTLOG_API_URL (default http://localhost:4790)."
echo "Add .agentlog/ to this repo's .gitignore if you don't want the helper script committed."
