#!/usr/bin/env bash
# Seed missing droid mirrors from live public/bit sources so Vercel can link them.
# Requires GITHUB_PAT (or GH_PAT) with repo create + push on robertdavidcashman-droid.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN="${GITHUB_PAT:-${GH_PAT:-}}"

if [[ -z "$TOKEN" ]]; then
  echo "Set GITHUB_PAT or GH_PAT first (see DEPLOY_ONCE.md)."
  exit 1
fi
export GH_TOKEN="$TOKEN"

seed_mirror() {
  local src_slug="$1"
  local dst_slug="$2"
  local dir="$3"
  local branch="${4:-main}"

  echo "=== Seed $dst_slug from $src_slug → $dir ==="
  if ! gh repo view "$src_slug" &>/dev/null; then
    echo "SKIP: source $src_slug not accessible"
    return 1
  fi

  if ! gh repo view "$dst_slug" &>/dev/null; then
    echo "Creating $dst_slug…"
    gh repo create "$dst_slug" --public --description "Mirror for auto-deploy ($dst_slug)"
  else
    echo "Dest $dst_slug already exists"
  fi

  local tmp
  tmp=$(mktemp -d)
  git clone --depth 1 "https://x-access-token:${TOKEN}@github.com/${src_slug}.git" "$tmp/src"
  cd "$tmp/src"
  # Ensure destination remote
  git remote remove dest 2>/dev/null || true
  git remote add dest "https://x-access-token:${TOKEN}@github.com/${dst_slug}.git"
  local src_branch
  src_branch=$(git rev-parse --abbrev-ref HEAD)
  git push dest "${src_branch}:refs/heads/${branch}" --force
  echo "Pushed $src_slug@$src_branch → $dst_slug@$branch"

  # Refresh local workspace clone
  mkdir -p "$ROOT"
  if [[ -d "$ROOT/$dir/.git" ]]; then
    git -C "$ROOT/$dir" remote set-url origin "https://github.com/${dst_slug}.git" || true
    git -C "$ROOT/$dir" fetch origin || true
  else
    rm -rf "$ROOT/$dir"
    git clone "https://x-access-token:${TOKEN}@github.com/${dst_slug}.git" "$ROOT/$dir"
  fi
  rm -rf "$tmp"
}

# RepUK: public bit repo → droid mirror
seed_mirror "robertcashman-bit/Policestationrepuk" "robertdavidcashman-droid/policestationrepuk" "Policestationrepuk" "main" || true

# PSRTrain: only if a discoverable source exists
if gh repo view "robertcashman-bit/psrtrain" &>/dev/null; then
  seed_mirror "robertcashman-bit/psrtrain" "robertdavidcashman-droid/psrtrain" "pstrain-rebuild" "main" || true
elif gh repo view "robertcashman-bit/pstrain-rebuild" &>/dev/null; then
  seed_mirror "robertcashman-bit/pstrain-rebuild" "robertdavidcashman-droid/psrtrain" "pstrain-rebuild" "main" || true
else
  echo "WARN: No accessible PSRTrain source repo found to mirror."
  echo "      After Vercel MCP auth, identify the Git repo behind psrtrain.com and re-run with:"
  echo "      SRC_PSRTRAIN=owner/repo bash scripts/seed-missing-workspaces.sh"
fi

if [[ -n "${SRC_PSRTRAIN:-}" ]]; then
  seed_mirror "$SRC_PSRTRAIN" "robertdavidcashman-droid/psrtrain" "pstrain-rebuild" "main" || true
fi

echo "Seed complete. Confirm Vercel Git links (DEPLOY_ONCE.md §3)."
