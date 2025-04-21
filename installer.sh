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
TIMER_FILE_NAME="${APP_NAME}.timer"
CONFIG_FILE_NAME="config.json"
CREDENTIALS_FILE_NAME="client_secret.json" # Expected name for user-provided credentials
NODE_LOCK_FILE="$CONFIG_DIR/gphotos-sync.lock" # Lock file location for Node app

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

check_command() {
    if ! command -v $1 &> /dev/null; then
        echo_red "Error: Required command '$1' not found. Please install it."
        exit 1
    fi
}

# --- Dependency Checks ---
echo_blue "Checking dependencies..."
check_command "node"
check_command "npm"
check_command "systemctl"
echo_green "Dependencies found."

# --- Scheduling Choice ---
echo_blue "Configure Sync Schedule"
echo "How often should the sync run?"
echo "  1) Hourly"
echo "  2) Daily"
echo "  3) Weekly"
echo "(Enter number 1-3)"

SCHEDULE_CHOICE=""
TIMER_SPEC=""

while [[ -z "$TIMER_SPEC" ]]; do
    read -p "Schedule choice [1]: " SCHEDULE_CHOICE
    SCHEDULE_CHOICE=${SCHEDULE_CHOICE:-1} # Default to Hourly if empty
    case $SCHEDULE_CHOICE in
        1) TIMER_SPEC="hourly" ; break ;; # systemd special calendar event
        2) TIMER_SPEC="daily" ; break ;;  # systemd special calendar event
        3) TIMER_SPEC="weekly" ; break ;; # systemd special calendar event
        *) echo_red "Invalid choice. Please enter 1, 2, or 3." ;; 
    esac
done
echo_green "Selected schedule: $TIMER_SPEC"

# --- Create Directories ---
echo_blue "Creating installation directories..."
mkdir -vp "$INSTALL_DIR"
mkdir -vp "$CONFIG_DIR"
mkdir -vp "$DATA_DIR" 
mkdir -vp "$SERVICE_DIR"
echo_green "Directories created: $INSTALL_DIR, $CONFIG_DIR, $DATA_DIR, $SERVICE_DIR"

# --- Copy Application Files ---
echo_blue "Copying application files to $INSTALL_DIR ..."
# Assuming installer is run from the project root
cp -Rv ./src "$INSTALL_DIR/"
cp -v ./package.json "$INSTALL_DIR/"
cp -v ./package-lock.json "$INSTALL_DIR/"
cp -v ./run.js "$INSTALL_DIR/"
# Make run script executable
chmod +x "$INSTALL_DIR/run.js"
echo_green "Application files copied."

# --- Install Production Dependencies ---
echo_blue "Installing production Node.js dependencies in $INSTALL_DIR ..."
(cd "$INSTALL_DIR" && npm install --omit=dev --quiet)
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
  "debugMaxPages": 0,
  "debugMaxDownloads": 0
}
EOL
echo_green "Default configuration created."

# --- Create Systemd Service File (No Install section) ---
SERVICE_FILE_PATH="$SERVICE_DIR/$SERVICE_FILE_NAME"
echo_blue "Creating systemd service file..."

cat > "$SERVICE_FILE_PATH" << EOL
[Unit]
Description=Google Photos Sync Node Service (Run Once)
# No network dependency needed if timer handles retries/waiting

[Service]
Type=oneshot # Run once and exit
ExecStart=$INSTALL_DIR/run.js
WorkingDirectory=$INSTALL_DIR
# Lock file is handled within the node script
# Optional User/Group
EOL
echo_green "Systemd service file created at $SERVICE_FILE_PATH"

# --- Create Systemd Timer File ---
TIMER_FILE_PATH="$SERVICE_DIR/$TIMER_FILE_NAME"
echo_blue "Creating systemd timer file for '$TIMER_SPEC' schedule..."

cat > "$TIMER_FILE_PATH" << EOL
[Unit]
Description=Timer to run Google Photos Sync Node periodically ($TIMER_SPEC)

[Timer]
# Specifies the calendar event or interval
OnCalendar=$TIMER_SPEC
# Add some randomness to avoid thundering herd
RandomizedDelaySec=15min 
# Ensure it runs even if missed (e.g., machine was off)
Persistent=true 
Unit=$SERVICE_FILE_NAME

[Install]
WantedBy=timers.target
EOL
echo_green "Systemd timer file created at $TIMER_FILE_PATH"

# --- Enable Systemd Timer ---
echo_blue "Reloading systemd user daemon and enabling timer..."
systemctl --user daemon-reload
systemctl --user enable "$TIMER_FILE_NAME"
echo_green "Timer enabled."

# --- Final Instructions ---
echo_blue "==============================================="
echo_green "Installation Mostly Complete!"
echo_blue "==============================================="
echo
echo_yellow " ---> IMPORTANT NEXT STEPS <--- "
echo " 1. Place your Google API client secret file (downloaded from Google Cloud Console)"
echo "    into the configuration directory: $CONFIG_DIR"
echo "    Ensure the file is named exactly: $CREDENTIALS_FILE_NAME"
echo
echo " 2. Run the application MANUALLY ONCE in your terminal to perform the "
echo "    initial Google Account authorization (OAuth flow):"
echo "    cd $INSTALL_DIR && ./run.js"
echo "    (Follow the on-screen instructions: copy the URL, authorize in browser, paste code)"
echo
echo " 3. Once authorized, you can START the scheduled syncs with:"
echo "    systemctl --user start $TIMER_FILE_NAME"
echo
echo "    (The first sync will run after the RandomizedDelaySec + schedule interval)"
echo
echo_blue " --- Other Information --- "
echo " Config file: $CONFIG_PATH"
echo " Log/Data dir: $DATA_DIR"
echo " Lock file: $NODE_LOCK_FILE" 
echo " Systemd service: $SERVICE_FILE_PATH"
echo " Systemd timer: $TIMER_FILE_PATH"
echo
echo " To check timer status: systemctl --user status $TIMER_FILE_NAME"
echo " To check service logs: journalctl --user -u $SERVICE_FILE_NAME -f"
echo " To trigger a sync manually (outside schedule): systemctl --user start $SERVICE_FILE_NAME"
echo
echo_green "Setup finished. Remember to place credentials and run manually once!"

exit 0 