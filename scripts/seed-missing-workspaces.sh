#!/usr/bin/env bash
# Seed missing droid repos from a local clone or optional SRC_* override.
# Requires GITHUB_PAT (or GH_PAT) with repo create + push on robertdavidcashman-droid.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN="${GITHUB_PAT:-${GH_PAT:-}}"

if [[ -z "$TOKEN" ]]; then
  echo "Set GITHUB_PAT or GH_PAT first (see DEPLOY_ONCE.md)."
  exit 1
fi
export GH_TOKEN="$TOKEN"

push_local_to_droid() {
  local local_dir="$1"
  local dst_slug="$2"
  local branch="${3:-main}"

  echo "=== Push local $local_dir → $dst_slug@$branch ==="
  if [[ ! -d "$ROOT/$local_dir/.git" ]]; then
    echo "SKIP: no local clone at $local_dir"
    return 1
  fi
  if ! git -C "$ROOT/$local_dir" rev-parse HEAD >/dev/null 2>&1; then
    echo "SKIP: $local_dir has no commits"
    return 1
  fi

  if ! gh repo view "$dst_slug" &>/dev/null; then
    echo "Creating $dst_slug…"
    gh repo create "$dst_slug" --public --description "Sole home ($dst_slug)"
  else
    echo "Dest $dst_slug already exists"
  fi

  git -C "$ROOT/$local_dir" remote remove droid 2>/dev/null || true
  git -C "$ROOT/$local_dir" remote add droid "https://x-access-token:${TOKEN}@github.com/${dst_slug}.git"
  local src_branch
  src_branch=$(git -C "$ROOT/$local_dir" rev-parse --abbrev-ref HEAD)
  git -C "$ROOT/$local_dir" push droid "${src_branch}:refs/heads/${branch}" --force
  git -C "$ROOT/$local_dir" remote set-url origin "https://github.com/${dst_slug}.git"
  git -C "$ROOT/$local_dir" remote remove droid 2>/dev/null || true
  echo "Pushed $local_dir@$src_branch → $dst_slug@$branch"
}

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
    gh repo create "$dst_slug" --public --description "Sole home ($dst_slug)"
  else
    echo "Dest $dst_slug already exists"
  fi

  local tmp
  tmp=$(mktemp -d)
  git clone --depth 1 "https://x-access-token:${TOKEN}@github.com/${src_slug}.git" "$tmp/src"
  cd "$tmp/src"
  git remote remove dest 2>/dev/null || true
  git remote add dest "https://x-access-token:${TOKEN}@github.com/${dst_slug}.git"
  local src_branch
  src_branch=$(git rev-parse --abbrev-ref HEAD)
  git push dest "${src_branch}:refs/heads/${branch}" --force
  echo "Pushed $src_slug@$src_branch → $dst_slug@$branch"

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

# RepUK: prefer local clone (already has history), else optional SRC_REPUK
if git -C "$ROOT/Policestationrepuk" rev-parse HEAD >/dev/null 2>&1; then
  push_local_to_droid "Policestationrepuk" "robertdavidcashman-droid/policestationrepuk" "master" || true
elif [[ -n "${SRC_REPUK:-}" ]]; then
  seed_mirror "$SRC_REPUK" "robertdavidcashman-droid/policestationrepuk" "Policestationrepuk" "master" || true
else
  echo "WARN: No local Policestationrepuk commits and SRC_REPUK unset."
fi

# PSRTrain: only if discoverable source or local commits
if git -C "$ROOT/pstrain-rebuild" rev-parse HEAD >/dev/null 2>&1; then
  push_local_to_droid "pstrain-rebuild" "robertdavidcashman-droid/psrtrain" "main" || true
elif [[ -n "${SRC_PSRTRAIN:-}" ]]; then
  seed_mirror "$SRC_PSRTRAIN" "robertdavidcashman-droid/psrtrain" "pstrain-rebuild" "main" || true
else
  echo "WARN: PSRTrain source not available locally or via SRC_PSRTRAIN."
  echo "      Identify the Git repo behind psrtrain.com, then:"
  echo "      SRC_PSRTRAIN=owner/repo bash scripts/seed-missing-workspaces.sh"
fi

echo "Seed complete. Confirm Vercel Git links (DEPLOY_ONCE.md §4)."
