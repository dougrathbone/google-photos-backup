#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
# Ensure these match the installer script EXACTLY
APP_NAME="google-photos-backup"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/$APP_NAME"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/$APP_NAME"
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

SERVICE_FILE_NAME="${APP_NAME}.service"
TIMER_FILE_NAME="${APP_NAME}.timer"

# --- Helper Functions ---
echo_blue() {
    echo -e "\033[1;34m$1\033[0m"
}
echo_green() {
    echo -e "\033[0;32m$1\033[0m"
}
echo_red() {
    echo -e "\033[0;31m$1\033[0m"
}
echo_yellow() {
    echo -e "\033[0;33m$1\033[0m"
}

# --- Start Update ---
echo_blue "==============================================="
echo_blue " Google Photos Backup Updater                "
echo_blue "==============================================="
echo
echo_yellow "This script will update the installed application code"
echo_yellow "with the code from the current directory."
echo_yellow "It will stop the running service/timer temporarily."
echo

# --- Confirmation ---
read -p "Update installation in $INSTALL_DIR? (y/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo_red "Update cancelled."
    exit 1
fi
echo

# --- Check if installed ---
if [ ! -d "$INSTALL_DIR" ]; then
    echo_red "Error: Installation directory not found at $INSTALL_DIR"
    echo_red "Please install the application first using installer.sh"
    exit 1
fi

# --- Stop Service/Timer ---
echo_blue "[*] Stopping running service/timer (if active)..."
systemctl --user stop "$TIMER_FILE_NAME" || true 
systemctl --user stop "$SERVICE_FILE_NAME" || true
echo_green "    Service/timer stopped."
echo

# --- Copy Updated Application Files ---
echo_blue "[*] Copying updated application files from current directory..."
if [ ! -d "./src" ] || [ ! -f "./package.json" ] || [ ! -f "./run.js" ]; then
    echo_red "Error: Cannot find required files (src/, package.json, run.js) in current directory."
    echo_red "Please run this script from the root of the updated git repository clone."
    exit 1
fi

cp -Rv ./src "$INSTALL_DIR/"
cp -v ./package.json "$INSTALL_DIR/"
# Copy lock file only if it exists in the source repo (unlikely but possible)
[ -f ./package-lock.json ] && cp -v ./package-lock.json "$INSTALL_DIR/" || echo_yellow "    package-lock.json not found in source, skipping."
cp -v ./run.js "$INSTALL_DIR/"
# Ensure run script is executable
chmod +x "$INSTALL_DIR/run.js"
echo_green "    Application files copied to $INSTALL_DIR"
echo

# --- Update Production Dependencies ---
echo_blue "[*] Updating Node.js dependencies in $INSTALL_DIR (this may take a moment)..."
(cd "$INSTALL_DIR" && npm install --omit=dev --quiet)
echo_green "    Node.js dependencies updated."
echo

# --- Reminder to Restart --- 
echo_blue "==============================================="
echo_green " Update Complete!"
echo_blue "==============================================="
echo
echo_yellow " ---> IMPORTANT <--- "
echo " The application code and dependencies have been updated."
echo " You need to RESTART the systemd service or timer manually"
echo " for the changes to take effect."
echo
echo " If you were using the scheduled mode (Hourly/Daily/Weekly), restart the TIMER:"
echo "    systemctl --user restart $TIMER_FILE_NAME"
echo
echo " If you were using Continuous mode, restart the SERVICE:"
echo "    systemctl --user restart $SERVICE_FILE_NAME"
echo
echo " You can check the status afterwards with:"
echo "    systemctl --user status $SERVICE_FILE_NAME"
echo "    (or use $TIMER_FILE_NAME if applicable)"
echo

exit 0 