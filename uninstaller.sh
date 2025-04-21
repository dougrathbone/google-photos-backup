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

# --- Start Uninstallation ---
echo_blue "==============================================="
echo_blue " Google Photos Backup Uninstaller            "
echo_blue "==============================================="
echo
echo_yellow "This script will attempt to remove the application," 
echo_yellow "its configuration, logs, state, and systemd units."
echo_yellow "It will NOT delete your downloaded photos folder."
echo

# --- Confirmation ---
read -p "Are you sure you want to uninstall $APP_NAME? (y/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo_red "Uninstallation cancelled."
    exit 1
fi
echo

# --- Stop and Disable Systemd Units ---
echo_blue "[*] Stopping and disabling systemd units..."
# Stop both timer and service, ignore errors if they don't exist or aren't running
echo "    Stopping timer ($TIMER_FILE_NAME)..."
systemctl --user stop "$TIMER_FILE_NAME" || true 
echo "    Stopping service ($SERVICE_FILE_NAME)..."
systemctl --user stop "$SERVICE_FILE_NAME" || true

# Disable both timer and service, ignore errors if they aren't enabled
echo "    Disabling timer ($TIMER_FILE_NAME)..."
systemctl --user disable "$TIMER_FILE_NAME" || true
echo "    Disabling service ($SERVICE_FILE_NAME)..."
systemctl --user disable "$SERVICE_FILE_NAME" || true
echo_green "    Systemd units stopped and disabled (if they existed)."
echo

# --- Remove Systemd Files --- 
SERVICE_FILE_PATH="$SERVICE_DIR/$SERVICE_FILE_NAME"
TIMER_FILE_PATH="$SERVICE_DIR/$TIMER_FILE_NAME"
echo_blue "[*] Removing systemd files..."
if [ -f "$TIMER_FILE_PATH" ]; then
    rm -v "$TIMER_FILE_PATH"
    echo_green "    Removed timer file."
else
    echo_yellow "    Timer file not found (perhaps continuous mode was used?)."
fi
if [ -f "$SERVICE_FILE_PATH" ]; then
    rm -v "$SERVICE_FILE_PATH"
    echo_green "    Removed service file."
else
    echo_yellow "    Service file not found."
fi
echo_blue "[*] Reloading systemd user daemon..."
systemctl --user daemon-reload
echo_green "    Systemd daemon reloaded."
echo

# --- Remove Application Directories ---
echo_blue "[*] Removing application files and directories..."
if [ -d "$CONFIG_DIR" ]; then
    rm -rfv "$CONFIG_DIR"
    echo_green "    Removed configuration directory: $CONFIG_DIR"
else
    echo_yellow "    Configuration directory not found: $CONFIG_DIR"
fi

if [ -d "$INSTALL_DIR" ]; then
    rm -rfv "$INSTALL_DIR"
    echo_green "    Removed installation directory: $INSTALL_DIR"
else
    echo_yellow "    Installation directory not found: $INSTALL_DIR"
fi
echo

# --- Final Message ---
echo_blue "==============================================="
echo_green " Uninstallation Complete!"
echo_blue "==============================================="
echo
echo "Note: If you manually modified your photo download location"
echo "('localSyncDirectory' in config), that directory was NOT deleted."
echo

exit 0 