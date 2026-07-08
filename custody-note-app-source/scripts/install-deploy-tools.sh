#!/usr/bin/env bash
# Install GitHub CLI to ~/.local/bin (no Homebrew/sudo required).
set -euo pipefail

BIN_DIR="${HOME}/.local/bin"
mkdir -p "$BIN_DIR"

GH_VERSION="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).tag_name.replace('v','')")"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) GH_ARCH=arm64 ;;
  *) GH_ARCH=amd64 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ZIP="gh_${GH_VERSION}_macOS_${GH_ARCH}.zip"
curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${ZIP}" -o "$TMP/${ZIP}"
unzip -q "$TMP/${ZIP}" -d "$TMP"
install -m 755 "$TMP/gh_${GH_VERSION}_macOS_${GH_ARCH}/bin/gh" "$BIN_DIR/gh"

echo "Installed gh $(\"$BIN_DIR/gh\" --version | head -1) to $BIN_DIR/gh"
echo ""
echo "Add to PATH (once):"
echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zprofile"
echo ""
echo "Authenticate with workflow scope (required for deploy):"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
echo "  gh auth login -h github.com -p https -s repo,workflow,read:org,gist"
echo "  gh auth setup-git"
echo "  npm run check:deploy"
