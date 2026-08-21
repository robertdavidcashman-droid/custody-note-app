#!/bin/bash
# Create missing GitHub repos using a user PAT (repo scope).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/workspaces.manifest.json"
TOKEN="${GITHUB_PAT:-${GH_TOKEN:-}}"

if [[ -z "$TOKEN" ]]; then
  echo "GITHUB_PAT not set — skipping repo bootstrap (repos must exist or be created on Mac)."
  exit 0
fi

export GH_TOKEN="$TOKEN"

create_if_missing() {
  local slug="$1"
  local desc="$2"
  if gh repo view "$slug" &>/dev/null; then
    echo "Repo $slug already exists"
  else
    echo "Creating $slug..."
    gh repo create "$slug" --public --description "$desc" --add-readme
  fi
}

python3 - "$MANIFEST" <<'PY' | while IFS=$'\t' read -r slug desc; do
import json, sys
manifest = json.load(open(sys.argv[1]))
for repo in manifest["repos"]:
    slug = repo["github"]
    if slug.endswith("/policestationrepuk"):
        print(f"{slug}\tPoliceStationRepUK website - policestationrepuk.org")
    elif slug.endswith("/psrtrain"):
        print(f"{slug}\tPSRUKTrain website - psrtrain.com")
PY
  [[ -n "$slug" ]] && create_if_missing "$slug" "$desc"
done

echo "GitHub bootstrap complete."
