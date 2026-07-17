#!/usr/bin/env bash
# Publish the already-built v1.9.52 Windows installer to the production
# updater feed (robertcashman-bit/custody-note-app) so installed apps see it.
#
# Run on a machine signed in as robertcashman-bit (or with a PAT that can write there):
#   gh auth login   # as robertcashman-bit
#   bash custody-note-app-source/deploy-bundles/publish-v1.9.52-to-bit.sh
set -euo pipefail

REPO_SRC="${REPO_SRC:-robertdavidcashman-droid/custody-note-app}"
REPO_DST="${REPO_DST:-robertcashman-bit/custody-note-app}"
TAG="${TAG:-v1.9.52}"
WORKDIR="${TMPDIR:-/tmp}/cn-publish-${TAG}"

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "Downloading $TAG assets from $REPO_SRC…"
gh release download "$TAG" --repo "$REPO_SRC" \
  -p 'Custody-Note-Setup-*.exe' \
  -p 'Custody-Note-Setup-*.exe.blockmap' \
  -p 'latest.yml'

echo "Creating/updating release $TAG on $REPO_DST…"
if gh release view "$TAG" --repo "$REPO_DST" >/dev/null 2>&1; then
  gh release upload "$TAG" --repo "$REPO_DST" --clobber \
    Custody-Note-Setup-*.exe \
    Custody-Note-Setup-*.exe.blockmap \
    latest.yml
  gh release edit "$TAG" --repo "$REPO_DST" --draft=false --latest \
    --title "1.9.52" \
    --notes "QuickFile invoice number self-heal — finds the next free number when a number is already used."
else
  gh release create "$TAG" --repo "$REPO_DST" \
    --title "1.9.52" \
    --notes "QuickFile invoice number self-heal — finds the next free number when a number is already used." \
    Custody-Note-Setup-*.exe \
    Custody-Note-Setup-*.exe.blockmap \
    latest.yml
fi

echo "Done. Check for updates in the app should now offer 1.9.52."
echo "Feed: https://github.com/${REPO_DST}/releases/latest/download/latest.yml"
