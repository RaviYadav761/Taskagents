#!/usr/bin/env bash
# Taskly Local Automation Agent - macOS launchd Service Installer
set -e

PLIST_NAME="io.taskly.agent.plist"
USER_LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
TARGET_PLIST="$USER_LAUNCH_AGENTS/$PLIST_NAME"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(which node || echo "/usr/local/bin/node")"

echo "========================================================"
echo "Installing Taskly Local Agent as macOS Login Service"
echo "Project Directory: $PROJECT_DIR"
echo "Node Executable:   $NODE_BIN"
echo "========================================================"

mkdir -p "$USER_LAUNCH_AGENTS"

cat <<EOF > "$TARGET_PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.taskly.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$PROJECT_DIR/agent/index.js</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$PROJECT_DIR/agent/data/agent.log</string>
    <key>StandardErrorPath</key>
    <string>$PROJECT_DIR/agent/data/agent.err</string>
</dict>
</plist>
EOF

# Unload previous instance if loaded
launchctl unload "$TARGET_PLIST" 2>/dev/null || true

# Load and start service
launchctl load "$TARGET_PLIST"

echo "✅ Taskly Local Agent successfully installed and registered!"
echo "Service will automatically start at user login."
echo "Logs: $PROJECT_DIR/agent/data/agent.log"
