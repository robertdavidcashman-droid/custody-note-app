#!/bin/bash
# Verify Vercel Git links for the four website projects.
# Requires VERCEL_TOKEN (https://vercel.com/account/tokens) or Vercel MCP auth in Cursor.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERCEL_BIN="${ROOT}/.vercel-tools/node_modules/.bin/vercel"

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "VERCEL_TOKEN is not set."
  echo "Add it to Cloud Agent secrets or export it locally, then re-run."
  echo "Alternatively, connect Vercel MCP in Cursor Desktop."
  echo ""
  echo "Manual checklist (Vercel Dashboard -> Project -> Settings -> Git):"
  echo "  web44ai              -> robertdavidcashman-droid/one"
  echo "  policestationrepuk   -> robertdavidcashman-droid/policestationrepuk"
  echo "  custody-note-website -> robertdavidcashman-droid/custody-note-website"
  echo "  pstrain              -> robertdavidcashman-droid/psrtrain"
  exit 2
fi

if [[ ! -x "$VERCEL_BIN" ]]; then
  echo "Installing Vercel CLI..."
  npm install vercel@latest --prefix "$ROOT/.vercel-tools" --silent
fi

export VERCEL_ORG_ID="${VERCEL_ORG_ID:-}"
export VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-}"

echo "=== Vercel projects (teams) ==="
"$VERCEL_BIN" teams ls --token "$VERCEL_TOKEN" 2>&1 || true

echo ""
echo "=== Expected Git links ==="
declare -A EXPECTED=(
  ["web44ai"]="one"
  ["custody-note-website"]="custody-note-website"
  ["pstrain"]="psrtrain"
  ["policestationrepuk"]="policestationrepuk"
)

FAIL=0
for project in "${!EXPECTED[@]}"; do
  repo="${EXPECTED[$project]}"
  echo "--- $project -> robertdavidcashman-droid/$repo ---"
  expected_full="robertdavidcashman-droid/$repo"

  inspect_json=""
  if inspect_json="$("$VERCEL_BIN" project inspect "$project" --token "$VERCEL_TOKEN" --json 2>/dev/null)"; then
    actual_full="$(python3 - "$expected_full" <<'PY'
import json,sys
expected = sys.argv[1]
data = json.load(sys.stdin)
link = data.get("link") or {}
repo = (link.get("repo") or "").strip()
print(repo)
PY
)"
  else
    inspect_txt="$("$VERCEL_BIN" project inspect "$project" --token "$VERCEL_TOKEN" 2>/dev/null || true)"
    actual_full="$(python3 - <<'PY'
import re,sys
txt = sys.stdin.read()
m = re.search(r'^\s*Git Repository:\s*(.+?)\s*$', txt, re.IGNORECASE | re.MULTILINE)
print((m.group(1).strip() if m else ""))
PY
<<<"$inspect_txt"
)"
  fi

  if [[ -z "$actual_full" ]]; then
    echo "  WARN: could not read Git repository link for '$project' (project missing or not linked)"
    ((FAIL++)) || true
  elif [[ "$actual_full" == "$expected_full" ]]; then
    echo "  OK: Git link matches ($actual_full)"
  else
    echo "  WARN: Git link mismatch"
    echo "    expected: $expected_full"
    echo "    actual:   $actual_full"
    ((FAIL++)) || true
  fi
done

echo ""
if [[ $FAIL -gt 0 ]]; then
  echo "Some projects need manual verification in https://vercel.com/dashboard"
  exit 1
fi
echo "Basic Vercel project presence check complete."
echo "Confirm each project's Git tab links to the correct GitHub repo."
exit 0
