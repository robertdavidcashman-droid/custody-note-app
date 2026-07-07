#!/bin/bash
# Clone or pull all workspace repos defined in workspaces.manifest.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/workspaces.manifest.json"
POLL_SECONDS="${SYNC_POLL_SECONDS:-60}"

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: $MANIFEST not found"
  exit 1
fi

repo_exists_on_github() {
  local slug="$1"
  gh repo view "$slug" &>/dev/null
}

wait_for_repo() {
  local slug="$1"
  local elapsed=0
  while ! repo_exists_on_github "$slug"; do
    if [[ $elapsed -ge $POLL_SECONDS ]]; then
      return 1
    fi
    echo "Waiting for $slug on GitHub (${elapsed}s/${POLL_SECONDS}s)..."
    sleep 5
    elapsed=$((elapsed + 5))
  done
  return 0
}

sync_repo() {
  local name="$1"
  local dir="$2"
  local slug="$3"
  local branch="$4"

  if [[ "$dir" == "." ]]; then
    echo "--- $name (root) — skip clone ---"
    git -C "$ROOT" fetch origin --quiet 2>/dev/null || true
    return 0
  fi

  echo "--- $name ($dir) ---"

  if ! repo_exists_on_github "$slug"; then
    if ! wait_for_repo "$slug"; then
      echo "  MISSING: $slug not on GitHub yet (run mac-push-missing-repos.sh on Mac)"
      return 1
    fi
  fi

  local url="https://github.com/${slug}.git"
  local path="$ROOT/$dir"

  if [[ ! -d "$path/.git" ]]; then
    echo "  Cloning $url -> $dir"
    if [[ -n "$branch" ]]; then
      git clone --branch "$branch" --single-branch "$url" "$path"
    else
      git clone "$url" "$path"
    fi
  else
    echo "  Pulling latest"
    git -C "$path" fetch origin --prune
    local current
    current=$(git -C "$path" branch --show-current 2>/dev/null || echo "")
    if [[ -n "$current" ]]; then
      if ! git -C "$path" pull --ff-only origin "$current" 2>/dev/null; then
        if ! git -C "$path" pull --ff-only 2>/dev/null; then
          echo "  ERROR: pull failed (non-fast-forward, auth, or remote error)"
          return 1
        fi
      fi
    fi
  fi

  return 0
}

echo "=== Sync all workspaces ==="
echo "Root: $ROOT"
echo ""

FAIL=0
while IFS=$'\t' read -r name dir slug branch; do
  sync_repo "$name" "$dir" "$slug" "$branch" || FAIL=1
done < <(python3 - "$MANIFEST" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
for repo in manifest["repos"]:
    print("\t".join([
        repo["name"],
        repo["dir"],
        repo["github"],
        repo["branch"],
    ]))
PY
)

echo ""
if [[ $FAIL -ne 0 ]]; then
  echo "ERROR: One or more repos could not be synced."
  exit 1
fi

echo "All workspace repos synced."
exit 0
