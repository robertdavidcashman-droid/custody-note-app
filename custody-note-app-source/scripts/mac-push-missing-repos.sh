#!/bin/bash
# Run once on your MacBook to create missing GitHub repos and push local code.
set -euo pipefail

GH="robertcashman-bit"
REPUK_DIR="${REPUK_DIR:-$HOME/Policestationrepuk}"
PSRTRAIN_DIR="${PSRTRAIN_DIR:-$HOME/pstrain-rebuild}"
STATUS_FILE="${HOME}/.cursor-workspace-sync-last-run.json"
DRY_RUN=0

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  echo "DRY RUN — no git push or repo create"
fi

create_repo_if_missing() {
  local name="$1"
  local desc="$2"
  if gh repo view "$GH/$name" &>/dev/null; then
    echo "Repo $GH/$name already exists"
  else
    echo "Creating $GH/$name..."
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "  [dry-run] would create $GH/$name"
      return 0
    fi
    gh repo create "$GH/$name" --public --description "$desc" --add-readme
  fi
}

push_local() {
  local dir="$1"
  local repo="$2"
  local branch="${3:-main}"

  if [[ ! -d "$dir" ]]; then
    echo "SKIP: $dir not found"
    return 1
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] would push $dir -> $GH/$repo"
    return 0
  fi

  cd "$dir"
  if [[ ! -d .git ]]; then
    echo "Initializing git in $dir"
    git init
    git add -A
    if ! git commit -m "Initial commit from Mac"; then
      echo "ERROR: Initial commit failed (nothing to commit or git identity/hooks issue)."
      return 1
    fi
  fi

  if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
    echo "ERROR: Repository has no commits; nothing to push from $dir."
    return 1
  fi

  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$GH/$repo.git"
  git fetch origin --prune 2>/dev/null || true

  local src=""
  if git show-ref --verify --quiet refs/heads/main; then
    src="main"
  elif git show-ref --verify --quiet "refs/heads/$branch"; then
    src="$branch"
  elif git show-ref --verify --quiet refs/heads/master; then
    src="master"
  else
    src="$branch"
    git branch -M "$src"
  fi

  local dest="main"
  if git show-ref --verify --quiet refs/remotes/origin/main; then
    dest="main"
  elif git show-ref --verify --quiet refs/remotes/origin/master; then
    dest="master"
  fi

  local local_sha remote_sha
  local_sha=$(git rev-parse HEAD)
  remote_sha=$(git rev-parse "origin/$dest" 2>/dev/null || echo "")

  if [[ "$local_sha" == "$remote_sha" ]]; then
    echo "Already up to date: $dir ($local_sha)"
    return 0
  fi

  git push -u origin "$src:$dest" --force-with-lease
  echo "Pushed $dir ($src -> $dest) -> $GH/$repo"
}

write_status() {
  if [[ $DRY_RUN -eq 1 ]]; then
    return 0
  fi
  python3 - <<PY
import json, datetime
print(json.dumps({
    "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
    "repuk_dir": "$REPUK_DIR",
    "psrtrain_dir": "$PSRTRAIN_DIR",
    "status": "ok"
}, indent=2))
PY
}

echo "=== Creating GitHub repos (if missing) ==="
create_repo_if_missing "Policestationrepuk" "PoliceStationRepUK website - policestationrepuk.org"
create_repo_if_missing "pstrain-rebuild" "PSRUKTrain website - psrtrain.com"

echo ""
echo "=== Pushing PoliceStationRepUK ($REPUK_DIR) ==="
FAIL=0
push_local "$REPUK_DIR" "Policestationrepuk" master || FAIL=1

echo ""
echo "=== Pushing PSRUKTrain ($PSRTRAIN_DIR) ==="
push_local "$PSRTRAIN_DIR" "pstrain-rebuild" master || FAIL=1

if [[ $FAIL -ne 0 ]]; then
  echo ""
  echo "ERROR: One or more pushes failed; see logs above."
  exit 1
fi

write_status > "$STATUS_FILE"
echo ""
echo "Status written to $STATUS_FILE"
echo "Done. Cloud Agent will auto-sync via scripts/sync-all-workspaces.sh"
