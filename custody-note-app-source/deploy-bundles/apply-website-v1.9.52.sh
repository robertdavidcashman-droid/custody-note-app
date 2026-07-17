#!/usr/bin/env bash
# Apply the v1.9.52 website changelog sync and push to trigger Vercel.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# deploy-bundles/ lives inside custody-note-app-source/; workspace root is two levels up.
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd "$APP_ROOT/.." && pwd)"
if [[ -n "${WEBSITE_ROOT:-}" ]]; then
  WEBSITE="$WEBSITE_ROOT"
elif [[ -d "$WORKSPACE_ROOT/custody-note-website/.git" ]]; then
  WEBSITE="$WORKSPACE_ROOT/custody-note-website"
elif [[ -d "$APP_ROOT/../custody-note-website/.git" ]]; then
  WEBSITE="$(cd "$APP_ROOT/../custody-note-website" && pwd)"
else
  WEBSITE="$WORKSPACE_ROOT/custody-note-website"
fi
BUNDLE="$SCRIPT_DIR/website-v1.9.52"
if [[ ! -d "$WEBSITE/.git" ]]; then
  echo "Website repo not found at $WEBSITE"
  echo "Set WEBSITE_ROOT to your custody-note-website clone and retry."
  exit 1
fi
mkdir -p "$WEBSITE/data" "$WEBSITE/src/app/changelog" "$WEBSITE/src/lib"
cp "$BUNDLE/data/releases.json" "$WEBSITE/data/releases.json"
cp "$BUNDLE/src/app/changelog/page.tsx" "$WEBSITE/src/app/changelog/page.tsx"
cp "$BUNDLE/src/lib/config.ts" "$WEBSITE/src/lib/config.ts"
cd "$WEBSITE"
git add data/releases.json src/app/changelog/page.tsx src/lib/config.ts
git commit -m "Changelog: sync releases.json to v1.9.52" || echo "Nothing to commit"
git pull --rebase origin master || true
git push origin master
echo "Pushed — Vercel should auto-deploy custodynote.com"
