#!/usr/bin/env bash
# Apply the v1.9.52 website changelog sync and push to trigger Vercel.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEBSITE="${WEBSITE_ROOT:-$ROOT/../custody-note-website}"
BUNDLE="$(cd "$(dirname "$0")" && pwd)/website-v1.9.52"
if [[ ! -d "$WEBSITE/.git" ]]; then
  echo "Website repo not found at $WEBSITE"
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
