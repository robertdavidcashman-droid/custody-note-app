#!/bin/bash
# Health check for all workspace folders (reads workspaces.manifest.json).
# Resolves Mac sibling layout ($HOME/<homeDir>) and Cloud nested layout ($ROOT/<dir>).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/workspaces.manifest.json"
HOME_ROOT="${HOME:-}"

FAIL=0
WARN=0

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: $MANIFEST not found"
  exit 1
fi

resolve_path() {
  local dir="$1"
  local home_dir="$2"
  if [[ "$dir" == "." ]]; then
    echo "$ROOT"
    return
  fi
  if [[ -d "$ROOT/$dir/.git" ]]; then
    echo "$ROOT/$dir"
    return
  fi
  if [[ -n "$home_dir" && -d "$HOME_ROOT/$home_dir/.git" ]]; then
    echo "$HOME_ROOT/$home_dir"
    return
  fi
  # Prefer nested path for error messages when neither exists.
  echo "$ROOT/$dir"
}

check_repo() {
  local name="$1"
  local dir="$2"
  local home_dir="$3"
  local remote="$4"
  local branch="$5"
  local need_pkg="$6"

  local git_dir
  git_dir="$(resolve_path "$dir" "$home_dir")"

  echo "--- $name ($git_dir) ---"

  if [[ ! -d "$git_dir" ]]; then
    echo "  MISSING: folder not found"
    ((FAIL++)) || true
    return
  fi

  if [[ ! -d "$git_dir/.git" ]]; then
    echo "  FAIL: not a git repository"
    ((FAIL++)) || true
    return
  fi

  local url
  url=$(git -C "$git_dir" remote get-url origin 2>/dev/null || echo "")
  if [[ "$url" != *"$remote"* ]]; then
    echo "  FAIL: origin should contain '$remote' (got: ${url:-none})"
    ((FAIL++)) || true
  else
    echo "  OK: remote -> $remote"
  fi

  local cur
  cur=$(git -C "$git_dir" branch --show-current 2>/dev/null || echo "")
  if [[ "$cur" == "$branch" ]] || [[ "$cur" == "main" && "$branch" == "master" ]] || [[ "$cur" == "master" && "$branch" == "main" ]]; then
    echo "  OK: branch $cur"
  else
    echo "  WARN: on branch '$cur' (expected $branch)"
    ((WARN++)) || true
  fi

  if [[ -n "$(git -C "$git_dir" status --porcelain 2>/dev/null)" ]]; then
    echo "  WARN: uncommitted changes"
    ((WARN++)) || true
  else
    echo "  OK: clean working tree"
  fi

  if [[ "$need_pkg" == "true" ]] && [[ ! -f "$git_dir/package.json" ]]; then
    echo "  WARN: package.json missing (repo may be README-only — push from Mac?)"
    ((WARN++)) || true
  elif [[ "$need_pkg" == "true" ]]; then
    echo "  OK: package.json present"
  fi
}

echo "Workspace root: $ROOT"
echo ""

while IFS=$'\t' read -r name dir home_dir remote branch need_pkg; do
  check_repo "$name" "$dir" "$home_dir" "$remote" "$branch" "$need_pkg"
done < <(python3 - "$MANIFEST" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
for repo in manifest["repos"]:
    need_pkg = "false" if repo["dir"] == "." else "true"
    print("\t".join([
        repo["name"],
        repo["dir"],
        repo.get("homeDir") or "",
        repo["github"],
        repo["branch"],
        need_pkg,
    ]))
PY
)

echo ""
echo "=== Summary ==="
echo "Failures: $FAIL"
echo "Warnings: $WARN"

if [[ $FAIL -gt 0 ]]; then
  echo "Some workspaces failed checks."
  exit 1
fi

echo "All workspace checks passed."
exit 0
