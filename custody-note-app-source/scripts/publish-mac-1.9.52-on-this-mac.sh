#!/usr/bin/env bash
# Run THIS on your Mac (not the Linux cloud agent) to sign, notarise, and upload
# Mac installers for the current package.json version (1.9.52).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS. This machine is $(uname -s)."
  exit 1
fi

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local — running interactive Apple setup…"
  node scripts/setup-apple-env.mjs
fi

# shellcheck disable=SC1091
set -a
# loadEnv is also done inside complete-mac-release; export here for cert check
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  export "$line" 2>/dev/null || true
done < .env.local
set +a

echo "Verifying Developer ID certificate in Keychain…"
npm run verify:mac:cert

if [[ -z "${GH_TOKEN:-}${GITHUB_TOKEN:-}${GH_PAT:-}" ]]; then
  if command -v gh >/dev/null && gh auth token >/dev/null 2>&1; then
    export GH_TOKEN
    GH_TOKEN="$(gh auth token)"
  else
    echo "Set GH_TOKEN (or gh auth login) so assets can upload to GitHub Releases."
    exit 1
  fi
fi

export GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-${GH_PAT}}}"
export GITHUB_TOKEN="$GH_TOKEN"

echo "Building + uploading Mac release for v$(node -p "require('./package.json').version")…"
npm ci
npm run complete-mac-release

echo "Done. Check:"
echo "  https://github.com/robertdavidcashman-droid/custody-note-app/releases/tag/v$(node -p "require('./package.json').version")"
