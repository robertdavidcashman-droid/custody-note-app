#!/bin/bash
# Run on MacBook to install a LaunchAgent that auto-pushes workspace repos every 5 minutes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.custodynote.workspace-sync.plist"
LOG="$HOME/Library/Logs/cursor-workspace-sync.log"
REPUK_DIR="${REPUK_DIR:-$HOME/Policestationrepuk}"
PSRTRAIN_DIR="${PSRTRAIN_DIR:-$HOME/pstrain-rebuild}"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.custodynote.workspace-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${ROOT}/scripts/mac-push-missing-repos.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>REPUK_DIR</key>
    <string>${REPUK_DIR}</string>
    <key>PSRTRAIN_DIR</key>
    <string>${PSRTRAIN_DIR}</string>
  </dict>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG}</string>
  <key>StandardErrorPath</key>
  <string>${LOG}</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/com.custodynote.workspace-sync" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.custodynote.workspace-sync"
launchctl kickstart -k "gui/$(id -u)/com.custodynote.workspace-sync"

echo "Installed LaunchAgent: com.custodynote.workspace-sync"
echo "  Runs every 5 minutes and on login"
echo "  Log: $LOG"
echo "  REPUK_DIR=$REPUK_DIR"
echo "  PSRTRAIN_DIR=$PSRTRAIN_DIR"
echo ""
echo "Test now: bash ${ROOT}/scripts/mac-push-missing-repos.sh"
