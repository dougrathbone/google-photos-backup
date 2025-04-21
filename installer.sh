#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
# Using user-specific directories based on XDG Base Directory Specification (freedesktop.org)
APP_NAME="google-photos-backup"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/$APP_NAME"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/$APP_NAME"
DATA_DIR="$INSTALL_DIR/data" # Store logs and state within the app's data dir
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

SERVICE_FILE_NAME="${APP_NAME}.service"
TIMER_FILE_NAME="${APP_NAME}.timer"
CONFIG_FILE_NAME="config.json"
CREDENTIALS_FILE_NAME="client_secret.json" # Expected name for user-provided credentials
NODE_LOCK_FILE="$CONFIG_DIR/${APP_NAME}.lock" # Update lock file name

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
echo_blue "[*] Configure Sync Schedule"
echo "    How often should the sync run?"
echo "      1) Hourly (Recommended for scheduled sync)"
# echo "      2) Every 6 Hours" 
echo "      2) Daily"
echo "      3) Weekly"
echo "      4) Continuous (Checks approx every 5 minutes)"
echo "         (NOTE: Use this only if you understand the implications of a long-running process)"
echo "    (Enter number 1-4)"

SCHEDULE_CHOICE=""
TIMER_SPEC=""
CONTINUOUS_MODE=false

while true; do # Loop until valid choice
    read -p "    Schedule choice [1]: " SCHEDULE_CHOICE
    SCHEDULE_CHOICE=${SCHEDULE_CHOICE:-1} # Default to Hourly
    case $SCHEDULE_CHOICE in
        1) TIMER_SPEC="hourly"; CONTINUOUS_MODE=false; break ;; 
        2) TIMER_SPEC="daily"; CONTINUOUS_MODE=false; break ;;  
        3) TIMER_SPEC="weekly"; CONTINUOUS_MODE=false; break ;; 
        4) TIMER_SPEC="continuous"; CONTINUOUS_MODE=true; break ;; # Use a flag, no timer spec needed
        *) echo_red "    Invalid choice. Please enter 1, 2, 3, or 4." ;; 
    esac
done
echo_green "    Selected mode: $TIMER_SPEC"
echo

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
[ -f ./package-lock.json ] && cp -v ./package-lock.json "$INSTALL_DIR/" || echo_yellow "    package-lock.json not found in source, skipping."
cp -v ./run.js "$INSTALL_DIR/"
cp -v ./status.js "$INSTALL_DIR/" # Copy status script
# Make run script executable
chmod +x "$INSTALL_DIR/run.js"
chmod +x "$INSTALL_DIR/status.js" # Make status script executable
echo_green "    Application files copied to $INSTALL_DIR"
echo

# --- Install Production Dependencies ---
echo_blue "Installing production Node.js dependencies in $INSTALL_DIR ..."
(cd "$INSTALL_DIR" && npm install --omit=dev --quiet)
echo_green "Dependencies installed."

# --- Create Default Configuration ---
CONFIG_PATH="$CONFIG_DIR/$CONFIG_FILE_NAME"
echo_blue "[*] Creating default configuration file..."

cat > "$CONFIG_PATH" << EOL
{
  "localSyncDirectory": "$DATA_DIR/gphotos_backup",
  "syncIntervalHours": 6, # Note: syncIntervalHours is ignored in continuous mode
  "credentialsPath": "$CONFIG_DIR/$CREDENTIALS_FILE_NAME",
  "logFilePath": "$DATA_DIR/gphotos_sync.log",
  "stateFilePath": "$DATA_DIR/sync_state.json",
  "debugMaxPages": 0,
  "debugMaxDownloads": 0,
  "continuousMode": $CONTINUOUS_MODE
}
EOL
echo_green "    Default configuration created at $CONFIG_PATH (continuousMode set to $CONTINUOUS_MODE)"
echo

# --- Create Systemd Service File (Always Type=simple now) ---
SERVICE_FILE_PATH="$SERVICE_DIR/$SERVICE_FILE_NAME"
echo_blue "[*] Creating systemd service file..."

cat > "$SERVICE_FILE_PATH" << EOL
[Unit]
Description=Google Photos Backup Service
# Use network-online only if absolutely needed; the script might handle brief offline periods
# After=network-online.target
# Wants=network-online.target

[Service]
Type=simple # Changed from oneshot - Node process manages its own lifetime
ExecStart=$INSTALL_DIR/run.js
WorkingDirectory=$INSTALL_DIR
Restart=on-failure # Restart if the Node process crashes
RestartSec=30
# Lock file handled by the script

# Optional User/Group (usually not needed for --user service)
# User=%i
# Group=%i

[Install]
WantedBy=default.target # Service install target
EOL
echo_green "    Systemd service file created at $SERVICE_FILE_PATH"
echo

# --- Create/Enable Timer OR Enable Service ---
systemctl --user daemon-reload

if [ "$CONTINUOUS_MODE" = true ]; then
    # Continuous mode: Enable the SERVICE directly
    echo_blue "[*] Enabling systemd SERVICE for continuous mode..."
    systemctl --user enable "$SERVICE_FILE_NAME"
    echo_green "    Service enabled for continuous operation."
else
    # Scheduled mode: Create and enable the TIMER
    TIMER_FILE_PATH="$SERVICE_DIR/$TIMER_FILE_NAME"
    echo_blue "[*] Creating systemd TIMER file for '$TIMER_SPEC' schedule..."
    cat > "$TIMER_FILE_PATH" << EOL
[Unit]
Description=Timer to run Google Photos Backup periodically ($TIMER_SPEC)
Requires=$SERVICE_FILE_NAME # Ensure service file exists

[Timer]
OnCalendar=$TIMER_SPEC
RandomizedDelaySec=15min 
Persistent=true 
Unit=$SERVICE_FILE_NAME

[Install]
WantedBy=timers.target
EOL
    echo_green "    Systemd timer file created at $TIMER_FILE_PATH"
    echo_blue "[*] Enabling systemd TIMER for scheduled mode..."
    systemctl --user enable "$TIMER_FILE_NAME"
    echo_green "    Timer enabled for $TIMER_SPEC schedule."
fi
echo

# --- Final Instructions (Adjust based on mode) ---
echo_blue "==============================================="
echo_blue " Google Photos Backup Installer              "
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
if [ "$CONTINUOUS_MODE" = true ]; then
    echo " 3. Once authorized, you can START the continuous service with:"
    echo "    systemctl --user start $SERVICE_FILE_NAME"
else
    echo " 3. Once authorized, you can START the scheduled syncs with:"
    echo "    systemctl --user start $TIMER_FILE_NAME"
    echo "    (The first sync will run based on schedule + random delay)"
fi
echo
echo_blue " --- Other Information --- "
echo " Config file: $CONFIG_PATH"
echo " Log/Data dir: $DATA_DIR"
echo " Lock file: $NODE_LOCK_FILE" 
echo " Systemd service: $SERVICE_FILE_PATH"
if [ "$CONTINUOUS_MODE" = false ]; then
    echo " Systemd timer: $TIMER_FILE_PATH"
fi
echo " To check timer status: systemctl --user status $TIMER_FILE_NAME"
echo " To check service status/logs: systemctl --user status $SERVICE_FILE_NAME"
echo " To view live logs: journalctl --user -u $SERVICE_FILE_NAME -f"
echo " To trigger a sync manually now: systemctl --user start $SERVICE_FILE_NAME"
echo " To check the sync status: $INSTALL_DIR/status.js"
echo
echo_green "Setup finished. Remember to place credentials and run manually once!"

exit 0 