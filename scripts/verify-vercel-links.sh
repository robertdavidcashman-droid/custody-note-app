#!/bin/bash
# Verify Vercel Git links for website projects.
# Requires VERCEL_TOKEN (https://vercel.com/account/tokens) or Vercel MCP auth in Cursor.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERCEL_BIN="${ROOT}/.vercel-tools/node_modules/.bin/vercel"
MANIFEST="$ROOT/workspaces.manifest.json"

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "VERCEL_TOKEN is not set."
  echo "Add it to Cloud Agent secrets or export it locally, then re-run."
  echo "Alternatively, connect Vercel MCP in Cursor Desktop."
  echo ""
  echo "Manual checklist (Vercel Dashboard -> Project -> Settings -> Git):"
  echo "  See DEPLOY_ONCE.md §3"
  python3 - "$MANIFEST" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for r in m["repos"]:
    if not r.get("vercel"):
        continue
    print(f"  {r['vercel']:24} -> {r['github']}")
PY
  exit 2
fi

if [[ ! -x "$VERCEL_BIN" ]]; then
  echo "Installing Vercel CLI..."
  npm install vercel@latest --prefix "$ROOT/.vercel-tools" --silent
fi

echo "=== Vercel projects (teams) ==="
"$VERCEL_BIN" teams ls --token "$VERCEL_TOKEN" 2>&1 || true

echo ""
echo "=== Expected Git links (from workspaces.manifest.json) ==="
FAIL=0
while IFS=$'\t' read -r project expected_full; do
  [[ -z "$project" ]] && continue
  echo "--- $project -> $expected_full ---"
  inspect_json=""
  if inspect_json="$("$VERCEL_BIN" project inspect "$project" --token "$VERCEL_TOKEN" --json 2>/dev/null)"; then
    actual_full="$(printf '%s' "$inspect_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); link=d.get("link") or {}; print((link.get("repo") or "").strip())')"
    if [[ "$actual_full" == "$expected_full" ]] || [[ "$actual_full" == *"/$(basename "$expected_full")" ]]; then
      echo "OK linked to $actual_full"
    else
      echo "FAIL expected $expected_full got '${actual_full:-none}'"
      FAIL=1
    fi
  else
    echo "WARN could not inspect project $project (name may differ — check dashboard)"
    FAIL=1
  fi
done < <(python3 - "$MANIFEST" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for r in m["repos"]:
    if r.get("vercel"):
        print(f"{r['vercel']}\t{r['github']}")
PY
)

exit "$FAIL"
