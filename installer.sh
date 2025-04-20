#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
# Using user-specific directories based on XDG Base Directory Specification (freedesktop.org)
APP_NAME="gphotos-sync-node"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/$APP_NAME"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/$APP_NAME"
DATA_DIR="$INSTALL_DIR/data" # Store logs and state within the app's data dir
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

SERVICE_FILE_NAME="${APP_NAME}.service"
CONFIG_FILE_NAME="config.json"
CREDENTIALS_FILE_NAME="client_secret.json" # Expected name for user-provided credentials

# --- Helper Functions ---
echo_green() {
    echo -e "\033[0;32m$1\033[0m"
}

echo_red() {
    echo -e "\033[0;31m$1\033[0m"
}

check_command() {
    if ! command -v $1 &> /dev/null; then
        echo_red "Error: Required command '$1' not found. Please install it."
        exit 1
    fi
}

# --- Dependency Checks ---
echo_green "Checking dependencies..."
check_command "node"
check_command "npm"
check_command "systemctl"
echo_green "Dependencies found."

# --- Create Directories ---
echo_green "Creating installation directories..."
mkdir -vp "$INSTALL_DIR"
mkdir -vp "$CONFIG_DIR"
mkdir -vp "$DATA_DIR" 
mkdir -vp "$SERVICE_DIR"
echo_green "Directories created."

# --- Copy Application Files ---
echo_green "Copying application files to $INSTALL_DIR ..."
# Assuming installer is run from the project root
cp -Rv ./src "$INSTALL_DIR/"
cp -v ./package.json "$INSTALL_DIR/"
cp -v ./package-lock.json "$INSTALL_DIR/"
cp -v ./run.js "$INSTALL_DIR/"
# Make run script executable
chmod +x "$INSTALL_DIR/run.js"
echo_green "Application files copied."

# --- Install Production Dependencies ---
echo_green "Installing production Node.js dependencies in $INSTALL_DIR ..."
(cd "$INSTALL_DIR" && npm install --omit=dev)
echo_green "Dependencies installed."

# --- Create Default Configuration ---
CONFIG_PATH="$CONFIG_DIR/$CONFIG_FILE_NAME"
echo_green "Creating default configuration file at $CONFIG_PATH ..."

# Use absolute paths in the installed config file
cat > "$CONFIG_PATH" << EOL
{
  "localSyncDirectory": "$DATA_DIR/gphotos_backup",
  "syncIntervalHours": 6,
  "credentialsPath": "$CONFIG_DIR/$CREDENTIALS_FILE_NAME",
  "logFilePath": "$DATA_DIR/gphotos_sync.log",
  "stateFilePath": "$DATA_DIR/sync_state.json",
  "debugMaxPages": 0
}
EOL
echo_green "Default configuration created."

# --- Copy Systemd Service File ---
SERVICE_FILE_PATH="$SERVICE_DIR/$SERVICE_FILE_NAME"
echo_green "Creating systemd service file at $SERVICE_FILE_PATH ..."

# Define the service file content
cat > "$SERVICE_FILE_PATH" << EOL
[Unit]
Description=Google Photos Sync Node Service
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
# Run the application using the run.js script
ExecStart=$INSTALL_DIR/run.js
WorkingDirectory=$INSTALL_DIR
Restart=on-failure
RestartSec=5
# Optional: Specify Node path if needed, but usually covered by user environment
# Environment="PATH=$HOME/.nvm/versions/node/v20.12.2/bin:/usr/local/bin:/usr/bin:/bin"
# Optional: Specify User/Group if needed for user service (usually implicit)
# User=%i
# Group=%i

[Install]
WantedBy=default.target
EOL
echo_green "Systemd service file created."

# --- Enable Systemd Service ---
echo_green "Reloading systemd user daemon and enabling service..."
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_FILE_NAME"
echo_green "Service enabled."

# --- Final Instructions ---
echo_green "-----------------------------------------------------"
echo_green "Installation complete!"
echo_green "-----------------------------------------------------"
echo
echo "IMPORTANT FINAL STEP:"
echo "1. Place your Google API client secret file (downloaded from Google Cloud Console)"
echo "   into the configuration directory:" 
echo "   $CONFIG_DIR"
echo "2. Ensure the file is named exactly: $CREDENTIALS_FILE_NAME"
echo
echo "Configuration file location: $CONFIG_PATH"
echo "Log file location: $DATA_DIR/gphotos_sync.log"
echo "Sync state file location: $DATA_DIR/sync_state.json"
echo
echo "To start the service now, run:"
echo "   systemctl --user start $SERVICE_FILE_NAME"
echo
echo "To check the service status, run:"
echo "   systemctl --user status $SERVICE_FILE_NAME"
echo
echo "To view logs, you can use journalctl:"
echo "   journalctl --user -u $SERVICE_FILE_NAME -f"
echo
echo_green "Setup finished."

exit 0 