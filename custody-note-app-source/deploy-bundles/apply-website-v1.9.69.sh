#!/usr/bin/env bash
# Apply the v1.9.69 website download cutover (droid Win+Mac) and push to trigger Vercel.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd "$APP_ROOT/.." && pwd)"
if [[ -n "${WEBSITE_ROOT:-}" ]]; then
  WEBSITE="$WEBSITE_ROOT"
elif [[ -d "$WORKSPACE_ROOT/custody-note-website/.git" ]]; then
  WEBSITE="$WORKSPACE_ROOT/custody-note-website"
else
  WEBSITE="$WORKSPACE_ROOT/custody-note-website"
fi
BUNDLE="$SCRIPT_DIR/website-v1.9.69"
if [[ ! -d "$WEBSITE/.git" ]]; then
  echo "Website repo not found at $WEBSITE"
  exit 1
fi
mkdir -p "$WEBSITE/data" "$WEBSITE/src/lib" "$WEBSITE/src/app/download" "$WEBSITE/src/app/api/stats/download"
cp "$BUNDLE/data/releases.json" "$WEBSITE/data/releases.json"
cp "$BUNDLE/src/lib/config.ts" "$WEBSITE/src/lib/config.ts"
cp "$BUNDLE/src/app/download/page.tsx" "$WEBSITE/src/app/download/page.tsx"
cp "$BUNDLE/src/app/api/stats/download/route.ts" "$WEBSITE/src/app/api/stats/download/route.ts"
cd "$WEBSITE"
git add data/releases.json src/lib/config.ts src/app/download/page.tsx src/app/api/stats/download/route.ts
git commit -m "Download: point Win+Mac 1.9.69 at droid release assets" || echo "Nothing to commit"
git pull --rebase origin master || true
git push origin master
echo "Pushed — if Vercel tracks droid custody-note-website, custodynote.com will update"
