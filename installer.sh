#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
APP_NAME="google-photos-backup"
SERVICE_USER="gphotosync" # User to run the service as
SERVICE_GROUP="gphotosync" # Group for the service user

# Standard Linux Directories
APP_CODE_DIR="/opt/$APP_NAME"
CONFIG_DIR="/etc/$APP_NAME"
DATA_DIR="/var/lib/$APP_NAME"
LOG_DIR="/var/log/$APP_NAME"
SYSTEMD_DIR="/etc/systemd/system"
WRAPPER_SCRIPT_PATH="/usr/local/bin/$APP_NAME" # Single management script

SERVICE_FILE_NAME="${APP_NAME}.service"
TIMER_FILE_NAME="${APP_NAME}.timer"
CONFIG_FILE_NAME="config.json"
CREDENTIALS_FILE_NAME="client_secret.json"
STATUS_FILE_NAME="status.json" # Name of the status file managed by the app
STATE_FILE_NAME="sync_state.json"
LOG_FILE_NAME="gphotos_sync.log"
# Lock file path determined by the application itself based on its environment

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

check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo_red "Error: This installer must be run as root or with sudo."
        exit 1
    fi
}

# --- Root Check ---
check_root

# --- Dependency Checks ---
echo_blue "[*] Checking dependencies..."
check_command "node"
check_command "npm"
check_command "systemctl"
check_command "groupadd" # Needed for creating group
check_command "useradd"  # Needed for creating user
check_command "chown"
check_command "chmod"
check_command "install" # Preferred for creating dirs with permissions
echo_green "    Dependencies found."
echo

# --- Scheduling Choice ---
echo_blue "[*] Configure Sync Schedule"
echo "    How often should the sync run?"
echo "      1) Hourly (Recommended for scheduled sync)"
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

# --- Create User/Group ---
echo_blue "[*] Setting up service user and group ('$SERVICE_USER:$SERVICE_GROUP')..."
if ! getent group "$SERVICE_GROUP" > /dev/null; then
    groupadd --system "$SERVICE_GROUP"
    echo_green "    Group '$SERVICE_GROUP' created."
else
    echo_yellow "    Group '$SERVICE_GROUP' already exists."
fi

if ! id -u "$SERVICE_USER" > /dev/null 2>&1; then
    useradd --system --no-create-home --gid "$SERVICE_GROUP" "$SERVICE_USER"
    echo_green "    User '$SERVICE_USER' created."
else
    echo_yellow "    User '$SERVICE_USER' already exists."
fi
echo

# --- Create Directories with Correct Permissions ---
echo_blue "[*] Creating core installation directories..."
install -d -m 755 -o root -g root "$APP_CODE_DIR"
install -d -m 750 -o root -g "$SERVICE_GROUP" "$CONFIG_DIR"
install -d -m 770 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$DATA_DIR"
install -d -m 770 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$LOG_DIR"
echo_green "    Core directories created/permissions set."
# /usr/local/bin should already exist and be suitable
echo

# --- Configure Backup Directory --- 
default_backup_dir="$DATA_DIR/gphotos_backup"
echo_blue "[*] Configure Local Backup Directory" 
read -p "    Enter the full path for photo backups [$default_backup_dir]: " user_input_backup_dir
# Use default if user entered nothing
user_input_backup_dir=${user_input_backup_dir:-$default_backup_dir}
# Trim leading/trailing whitespace and quotes
shopt -s extglob # Enable extended globbing for trim
CHOSEN_BACKUP_DIR="${user_input_backup_dir##*([[:space:]])}" # Trim leading space
CHOSEN_BACKUP_DIR="${CHOSEN_BACKUP_DIR%%*([[:space:]])}" # Trim trailing space
CHOSEN_BACKUP_DIR="${CHOSEN_BACKUP_DIR#\"}" # Trim leading quote
CHOSEN_BACKUP_DIR="${CHOSEN_BACKUP_DIR%\"}" # Trim trailing quote
CHOSEN_BACKUP_DIR="${CHOSEN_BACKUP_DIR#\'}" # Trim leading single quote
CHOSEN_BACKUP_DIR="${CHOSEN_BACKUP_DIR%\'}" # Trim trailing single quote
shopt -u extglob # Disable extended globbing

echo_blue "    Using backup directory path: $CHOSEN_BACKUP_DIR"
echo_blue "    Attempting to create/set permissions for: $CHOSEN_BACKUP_DIR ..."
# Create the directory and set ownership/permissions for the service user
if install -d -m 770 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$CHOSEN_BACKUP_DIR"; then
    echo_green "    Directory created/permissions set successfully."
    
    # Verify writability for the service user using su instead of sudo
    if ! su -s /bin/sh -c "test -w '$CHOSEN_BACKUP_DIR'" "$SERVICE_USER"; then
        echo_yellow "    WARNING: Verification failed. Service user '$SERVICE_USER' may not have write permissions."
        echo_yellow "             Please manually check permissions on: $CHOSEN_BACKUP_DIR"
    else
        echo_green "    Write permissions verified for service user '$SERVICE_USER'."
    fi
else
    # Handle error from install command
    echo_red "    ERROR: Failed to create or set permissions on $CHOSEN_BACKUP_DIR." 
    echo_red "           Please check the path and parent directory permissions."
    exit 1
fi
echo

# --- Copy Application Files ---
echo_blue "[*] Copying application files to $APP_CODE_DIR ..."
# Assuming installer is run from the project root
cp -R ./src "$APP_CODE_DIR/"
cp ./package.json "$APP_CODE_DIR/"
[ -f ./package-lock.json ] && cp ./package-lock.json "$APP_CODE_DIR/" || echo_yellow "    package-lock.json not found in source, skipping."
# Ensure correct ownership and permissions for code files
chown -R root:root "$APP_CODE_DIR"
find "$APP_CODE_DIR" -type d -exec chmod 755 {} \;
find "$APP_CODE_DIR" -type f -exec chmod 644 {} \;
# NOTE: We don't copy run.js or status.js anymore, they are replaced by the wrapper.
echo_green "    Application files copied to $APP_CODE_DIR"
echo

# --- Install Production Dependencies ---
echo_blue "[*] Installing production Node.js dependencies in $APP_CODE_DIR ..."
# Run npm install as root since /opt is root-owned, but ensure it doesn't create files owned by root in weird places
# It should operate within the $APP_CODE_DIR
(cd "$APP_CODE_DIR" && npm install --omit=dev --quiet)
# Reset ownership just in case npm created anything weirdly
chown -R root:root "$APP_CODE_DIR"
echo_green "    Dependencies installed."
echo

# --- Create Default Configuration ---
CONFIG_PATH="$CONFIG_DIR/$CONFIG_FILE_NAME"
echo_blue "[*] Creating default configuration file..."

# Escape backslashes and double quotes in the backup directory path for JSON compatibility
JSON_ESCAPED_BACKUP_DIR=$(sed 's/\\/\\\\/g; s/"/\\"/g' <<< "$CHOSEN_BACKUP_DIR")

cat > "$CONFIG_PATH" << EOL
{
  "localSyncDirectory": "$JSON_ESCAPED_BACKUP_DIR",
  "syncIntervalHours": 6,
  "credentialsPath": "$CONFIG_DIR/$CREDENTIALS_FILE_NAME",
  "logFilePath": "$LOG_DIR/$LOG_FILE_NAME",
  "stateFilePath": "$DATA_DIR/$STATE_FILE_NAME",
  "statusFilePath": "$DATA_DIR/$STATUS_FILE_NAME",
  "debugMaxPages": 0,
  "debugMaxDownloads": 0,
  "continuousMode": $CONTINUOUS_MODE
}
EOL
# Set restrictive permissions for config file (readable by root and service group only)
chown root:"$SERVICE_GROUP" "$CONFIG_PATH"
chmod 640 "$CONFIG_PATH"
echo_green "    Default configuration created at $CONFIG_PATH"
echo_yellow "    IMPORTANT: Ensure '$CREDENTIALS_FILE_NAME' exists in $CONFIG_DIR with correct content and permissions (chmod 640, chown root:$SERVICE_GROUP)."
echo

# --- Create Wrapper Script ---
echo_blue "[*] Creating management wrapper script at $WRAPPER_SCRIPT_PATH ..."
cat > "$WRAPPER_SCRIPT_PATH" << EOL
#!/bin/bash

APP_NAME="$APP_NAME"
APP_CODE_DIR="$APP_CODE_DIR"
CONFIG_DIR="$CONFIG_DIR"
DATA_DIR="$DATA_DIR"
LOG_DIR="$LOG_DIR"
SYSTEMD_DIR="$SYSTEMD_DIR"
SERVICE_FILE_NAME="$SERVICE_FILE_NAME"
TIMER_FILE_NAME="$TIMER_FILE_NAME"
SERVICE_USER="$SERVICE_USER"
SERVICE_GROUP="$SERVICE_GROUP"
UNINSTALL_SCRIPT="/usr/local/sbin/uninstall-\${APP_NAME}" # Place uninstaller in sbin
NODE_EXEC=\$(command -v node) # Find node executable

# Ensure Node.js is available
if [ -z "\$NODE_EXEC" ]; then
    echo "Error: Node.js executable not found in PATH."
    exit 1
fi

# Function to run the main application script
run_app() {
    # Run as the dedicated service user to ensure consistent permissions
    # Pass environment variables or arguments if needed by the app to know its context
    sudo -u "\$SERVICE_USER" \\
        NODE_ENV=production \\
        "\$NODE_EXEC" "\$APP_CODE_DIR/src/google-synchroniser.js"
}

# Function to show status
show_status() {
    local status_file="\$DATA_DIR/$STATUS_FILE_NAME"
    if [ -f "\$status_file" ]; then
        echo "Current Status (from \$status_file):"
        # Use jq if available for nice formatting, otherwise just cat
        if command -v jq &> /dev/null; then
            jq . "\$status_file"
        else
            cat "\$status_file"
        fi
        echo # Add a newline
        echo "Service Status (systemd):"
        systemctl status "\$SERVICE_FILE_NAME" | cat # Pipe through cat
        if [ -f "\$SYSTEMD_DIR/\$TIMER_FILE_NAME" ]; then
            echo "Timer Status (systemd):"
            systemctl status "\$TIMER_FILE_NAME" | cat # Pipe through cat
        fi
    else
        echo "Status file not found: \$status_file"
        echo "Service may not have run yet."
        echo "Check service status with: systemctl status \$SERVICE_FILE_NAME"
    fi
}

# Function for update (placeholder - needs actual implementation)
update_app() {
    echo "Update functionality not yet implemented."
    echo "To update manually:"
    echo " 1. cd to the source directory where you cloned the project."
    echo " 2. git pull origin main # Or the appropriate branch"
    echo " 3. sudo ./installer.sh # Re-run the installer"
    exit 1 # Indicate not implemented
}

# Function to trigger uninstall
uninstall_app() {
    if [ -f "\$UNINSTALL_SCRIPT" ]; then
        echo "Running uninstaller: \$UNINSTALL_SCRIPT ..."
        sudo "\$UNINSTALL_SCRIPT"
    else
        echo "Error: Uninstaller script not found at \$UNINSTALL_SCRIPT"
        exit 1
    fi
}

# Command handling
case "\$1" in
    start)
        echo "Starting the application directly (usually managed by systemd)..."
        run_app
        ;;
    sync)
        echo "Triggering a one-time sync via systemd service..."
        systemctl start "\$SERVICE_FILE_NAME"
        echo "Use '\$0 status' or 'journalctl -u \$SERVICE_FILE_NAME' to monitor."
        ;;
    status)
        show_status
        ;;
    update)
        update_app
        ;;
    uninstall)
        if [ "\$(id -u)" -ne 0 ]; then
             echo "Uninstall requires root privileges. Re-running with sudo..."
             sudo "\$0" uninstall
             exit \$?
        fi
        uninstall_app
        ;;
    logs)
        echo "Showing application logs (use Ctrl+C to exit)..."
        sudo journalctl -u "\$SERVICE_FILE_NAME" -f
        ;;
    *)
        echo "Usage: \$0 {start|sync|status|update|uninstall|logs}"
        echo "  start      : Run the main sync script directly (for testing, usually run by systemd)."
        echo "  sync       : Trigger a one-time sync using the systemd service."
        echo "  status     : Show current application status and systemd service/timer status."
        echo "  update     : (Placeholder) Check for and apply updates."
        echo "  uninstall  : Remove the application and its configuration."
        echo "  logs       : Follow the systemd journal logs for the service."
        exit 1
        ;;
esac

exit 0
EOL
chmod +x "$WRAPPER_SCRIPT_PATH"
echo_green "    Management script created at $WRAPPER_SCRIPT_PATH"
echo

# --- Create Systemd Service File ---
SERVICE_FILE_PATH="$SYSTEMD_DIR/$SERVICE_FILE_NAME"
echo_blue "[*] Creating systemd service file..."

# Define the ExecStart command WITHOUT extra escaping for variable expansion in cat
NODE_EXEC_PATH=$(command -v node)
EXEC_START_CMD="$NODE_EXEC_PATH \"$APP_CODE_DIR/src/google-synchroniser.js\""

cat > "$SERVICE_FILE_PATH" << EOL
[Unit]
Description=Google Photos Backup Service ($APP_NAME)
Documentation=file://$APP_CODE_DIR/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$APP_CODE_DIR

# Set environment variables for the app
Environment="NODE_ENV=production"
Environment="GPHOTOS_CONFIG_DIR=$CONFIG_DIR"
Environment="GPHOTOS_DATA_DIR=$DATA_DIR"
Environment="GPHOTOS_LOG_DIR=$LOG_DIR"

ExecStart=$EXEC_START_CMD

Restart=on-failure
RestartSec=30
TimeoutStartSec=300

# Standard Output/Error directed to journald
StandardOutput=journal
StandardError=journal

# Optional Security Hardening
# ProtectSystem=full
# ProtectHome=true
# PrivateTmp=true
# PrivateDevices=true
# NoNewPrivileges=true
# CapabilityBoundingSet=~CAP_SYS_ADMIN CAP_NET_ADMIN

[Install]
WantedBy=multi-user.target
EOL
chmod 644 "$SERVICE_FILE_PATH"
echo_green "    Systemd service file created at $SERVICE_FILE_PATH"
echo

# --- Create/Enable Timer OR Enable Service ---
echo_blue "[*] Reloading systemd daemon..."
systemctl daemon-reload
echo

if [ "$CONTINUOUS_MODE" = true ]; then
    # Continuous mode: Enable the SERVICE directly
    echo_blue "[*] Enabling systemd SERVICE for continuous mode..."
    systemctl enable "$SERVICE_FILE_NAME"
    echo_green "    Service '$SERVICE_FILE_NAME' enabled for continuous operation."
    echo_yellow "    You may need to start it manually the first time after auth:"
    echo_yellow "    sudo systemctl start $SERVICE_FILE_NAME"
else
    # Scheduled mode: Create and enable the TIMER
    TIMER_FILE_PATH="$SYSTEMD_DIR/$TIMER_FILE_NAME"
    echo_blue "[*] Creating systemd TIMER file for '$TIMER_SPEC' schedule..."
    cat > "$TIMER_FILE_PATH" << EOL
[Unit]
Description=Timer to run Google Photos Backup ($APP_NAME) periodically ($TIMER_SPEC)
Requires=$SERVICE_FILE_NAME

[Timer]
OnCalendar=$TIMER_SPEC
RandomizedDelaySec=15min
Persistent=true
Unit=$SERVICE_FILE_NAME

[Install]
WantedBy=timers.target
EOL
    chmod 644 "$TIMER_FILE_PATH"
    echo_green "    Systemd timer file created at $TIMER_FILE_PATH"
    echo_blue "[*] Enabling systemd TIMER for scheduled mode..."
    systemctl enable "$TIMER_FILE_NAME"
    echo_green "    Timer '$TIMER_FILE_NAME' enabled for $TIMER_SPEC schedule."
    echo_yellow "    The timer will start the service automatically based on the schedule."
    echo_yellow "    You can trigger the first sync manually if needed:"
    echo_yellow "    $APP_NAME sync" # Removed sudo here as well, command runs as root anyway
fi
echo

# --- Create Uninstaller Script ---
UNINSTALL_SCRIPT="/usr/local/sbin/uninstall-${APP_NAME}"
echo_blue "[*] Creating uninstaller script at $UNINSTALL_SCRIPT ..."
cat > "$UNINSTALL_SCRIPT" << EOL
#!/bin/bash
set -e

echo_blue() { echo -e "\033[1;34m$1\033[0m"; }
echo_red() { echo -e "\033[0;31m$1\033[0m"; }
echo_yellow() { echo -e "\033[0;33m$1\033[0m"; }

check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo_red "Error: Uninstaller must be run as root or with sudo."
        exit 1
    fi
}

check_root

echo_blue "Uninstalling $APP_NAME..."

# 1. Stop and Disable Systemd Units
echo_yellow "  Stopping and disabling systemd units..."
if systemctl list-unit-files | grep -q "$TIMER_FILE_NAME"; then
    systemctl stop "$TIMER_FILE_NAME" || true
    systemctl disable "$TIMER_FILE_NAME" || true
    echo "  Timer '$TIMER_FILE_NAME' stopped and disabled."
fi
if systemctl list-unit-files | grep -q "$SERVICE_FILE_NAME"; then
    systemctl stop "$SERVICE_FILE_NAME" || true
    systemctl disable "$SERVICE_FILE_NAME" || true
    echo "  Service '$SERVICE_FILE_NAME' stopped and disabled."
fi
systemctl daemon-reload
systemctl reset-failed # Clear any failed state

# 2. Remove Systemd Files
echo_yellow "  Removing systemd files..."
rm -f "$SYSTEMD_DIR/$TIMER_FILE_NAME"
rm -f "$SYSTEMD_DIR/$SERVICE_FILE_NAME"
echo "  Removed '$SYSTEMD_DIR/$TIMER_FILE_NAME' (if existed)."
echo "  Removed '$SYSTEMD_DIR/$SERVICE_FILE_NAME' (if existed)."

# 3. Remove Wrapper Script
echo_yellow "  Removing wrapper script..."
rm -f "$WRAPPER_SCRIPT_PATH"
echo "  Removed '$WRAPPER_SCRIPT_PATH'."

# 4. Remove Application Code Directory
echo_yellow "  Removing application code directory..."
rm -rf "$APP_CODE_DIR"
echo "  Removed '$APP_CODE_DIR'."

# 5. Remove Configuration Directory (Warn user)
echo_yellow "  Removing configuration directory (contains credentials!)..."
echo_red "  WARNING: This will delete $CONFIG_DIR, including your client_secret.json!"
read -p "  Proceed? (y/N): " confirm_config
if [[ "$confirm_config" == [yY] || "$confirm_config" == [yY][eE][sS] ]]; then
    rm -rf "$CONFIG_DIR"
    echo "  Removed '$CONFIG_DIR'."
else
    echo_yellow "  Skipping removal of $CONFIG_DIR."
fi

# 6. Remove Data and Log Directories (Warn user)
echo_yellow "  Removing data and log directories (contains state, logs, and potentially BACKED UP PHOTOS)..."
echo_red "  WARNING: This will delete $DATA_DIR (state, status) and $LOG_DIR (logs)."
echo_red "           It MAY also delete your actual photo backups if they were stored inside $DATA_DIR!"
read -p "  Check the 'localSyncDirectory' in '$CONFIG_PATH' before proceeding. Are you sure? (y/N): " confirm_data
if [[ "$confirm_data" == [yY] || "$confirm_data" == [yY][eE][sS] ]]; then
    rm -rf "$DATA_DIR"
    rm -rf "$LOG_DIR"
    echo "  Removed '$DATA_DIR'."
    echo "  Removed '$LOG_DIR'."
else
    echo_yellow "  Skipping removal of $DATA_DIR and $LOG_DIR."
fi

# 7. Remove Service User/Group (Optional - check if they are used by anything else)
echo_yellow "  Optionally remove user '$SERVICE_USER' and group '$SERVICE_GROUP'."
echo_yellow "  Skipping automatic removal. If desired, manually run:"
echo_yellow "  sudo userdel $SERVICE_USER"
echo_yellow "  sudo groupdel $SERVICE_GROUP"

# 8. Remove this uninstaller script
echo_yellow "  Removing uninstaller script itself..."
rm -f "$0" # Remove self

echo_blue "$APP_NAME uninstallation complete."
exit 0
EOL
chmod +x "$UNINSTALL_SCRIPT"
chown root:root "$UNINSTALL_SCRIPT"
echo_green "    Uninstaller script created at $UNINSTALL_SCRIPT"
echo

# --- Final Instructions ---
echo_blue "==============================================="
echo_blue " $APP_NAME System Installer                  "
echo_blue "==============================================="
echo
echo_yellow " ---> IMPORTANT NEXT STEPS <--- "
echo " 1. Place your Google API client secret file (downloaded from Google Cloud Console)"
echo "    into the configuration directory: $CONFIG_DIR"
echo "    Ensure the file is named exactly: '$CREDENTIALS_FILE_NAME'"
echo "    Set correct ownership and permissions:"
echo "    sudo chown root:$SERVICE_GROUP \"$CONFIG_DIR/$CREDENTIALS_FILE_NAME\""
echo "    sudo chmod 640 \"$CONFIG_DIR/$CREDENTIALS_FILE_NAME\""
echo
echo " 2. Run the application MANUALLY AS THE SERVICE USER ONCE in your terminal"
echo "    to perform the initial Google Account authorization (OAuth flow):"
echo "    su $SERVICE_USER -s /bin/bash -c 'NODE_ENV=production node $APP_CODE_DIR/src/google-synchroniser.js'"
echo "    (Follow the on-screen instructions: copy the URL, authorize in browser, paste code)"
echo "    (The state file will be saved in $DATA_DIR)"
echo
if [ "$CONTINUOUS_MODE" = true ]; then
    echo " 3. Once authorized, you can START the continuous service with:"
    echo "    sudo systemctl start $SERVICE_FILE_NAME"
    echo "    It is already enabled to start on boot."
else
    echo " 3. Once authorized, the scheduled timer is enabled and will trigger syncs automatically."
    echo "    To trigger the first sync manually immediately:"
    echo "    sudo $APP_NAME sync"
    echo "    The timer '$TIMER_FILE_NAME' is enabled to start on boot."
fi
echo
echo_blue " --- Management Commands --- "
echo " Use the '$APP_NAME' command:"
echo "   $APP_NAME status      : Check status"
echo "   $APP_NAME sync        : Trigger manual sync via systemd"
echo "   $APP_NAME logs        : View live service logs"
echo "   $APP_NAME update      : (Placeholder) Check for updates"
echo "   $APP_NAME uninstall   : Uninstall the application (requires sudo)"
echo
echo_blue " --- Configuration Summary --- "
echo " Config file: $CONFIG_PATH"
echo " Backup directory: $CHOSEN_BACKUP_DIR"
echo " Log/Data dir: $LOG_DIR / $DATA_DIR"
echo " App code dir: $APP_CODE_DIR"
echo " Systemd service: $SYSTEMD_DIR/$SERVICE_FILE_NAME"
if [ "$CONTINUOUS_MODE" = false ]; then
    echo " Systemd timer: $SYSTEMD_DIR/$TIMER_FILE_NAME"
fi
echo " Uninstaller: $UNINSTALL_SCRIPT"
echo
echo_green "Setup finished. Remember to place credentials, set permissions, and run manually once for auth!"
echo

exit 0 