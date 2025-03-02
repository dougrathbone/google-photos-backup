#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Default values
INSTALL_DIR="$HOME/.local/share/gphotos-sync"
CRON_SCHEDULE="0 2 * * *" # 2 AM daily

usage() {
    echo "Usage: $0 [install|uninstall|schedule|manual-sync]"
    echo "  install      - Install and configure gphotos-sync"
    echo "  uninstall    - Remove gphotos-sync and cleanup"
    echo "  schedule     - Configure or update backup schedule"
    echo "  manual-sync  - Run a manual sync now"
    exit 1
}

check_dependencies() {
    echo "Checking and installing dependencies..."
    sudo apt-get update
    sudo apt-get install -y python3 python3-pip python3-venv
}

configure_backup_dir() {
    # Prompt for backup directory
    read -p "Enter the path for photo backups [$HOME/google-photos-backup]: " input_dir
    BACKUP_DIR="${input_dir:-$HOME/google-photos-backup}"
    
    # Expand the path
    BACKUP_DIR=$(eval echo "$BACKUP_DIR")
    
    # Create directory if it doesn't exist
    if ! mkdir -p "$BACKUP_DIR" 2>/dev/null; then
        echo -e "${RED}Error: Cannot create directory $BACKUP_DIR${NC}"
        echo "Please check permissions and try again"
        exit 1
    }
    
    # Test write permissions
    if ! touch "$BACKUP_DIR/.test_write" 2>/dev/null; then
        echo -e "${RED}Error: Cannot write to $BACKUP_DIR${NC}"
        echo "Please check permissions and try again"
        exit 1
    }
    rm -f "$BACKUP_DIR/.test_write"
    
    echo -e "${GREEN}Backup directory $BACKUP_DIR is ready${NC}"
}

install_gphotos_sync() {
    echo "Installing gphotos-sync..."
    
    # Install script to local bin
    mkdir -p "$HOME/.local/bin"
    cp "$0" "$HOME/.local/bin/google-photos-backup"
    chmod +x "$HOME/.local/bin/google-photos-backup"
    
    # Configure backup directory first
    configure_backup_dir
    
    # Create virtual environment
    python3 -m venv "$INSTALL_DIR"
    source "$INSTALL_DIR/bin/activate"
    
    # Install gphotos-sync
    pip install gphotos-sync
    
    echo -e "${GREEN}Installation complete!${NC}"
    echo "Now we'll set up Google Photos authentication..."
    
    # Run initial auth
    gphotos-sync "$BACKUP_DIR"
    
    deactivate
}

setup_cron() {
    # Create wrapper script
    cat > "$INSTALL_DIR/sync-photos.sh" << EOL
#!/bin/bash
source "$INSTALL_DIR/bin/activate"
gphotos-sync "$BACKUP_DIR"
deactivate
EOL
    
    chmod +x "$INSTALL_DIR/sync-photos.sh"
    
    # Add to crontab
    (crontab -l 2>/dev/null; echo "$CRON_SCHEDULE $INSTALL_DIR/sync-photos.sh") | crontab -
    
    echo -e "${GREEN}Scheduled daily backups at 2 AM${NC}"
}

manual_sync() {
    echo "Running manual sync..."
    source "$INSTALL_DIR/bin/activate"
    gphotos-sync "$BACKUP_DIR"
    deactivate
    echo -e "${GREEN}Manual sync complete!${NC}"
}

uninstall() {
    echo "Uninstalling gphotos-sync..."
    
    # Remove from crontab
    crontab -l | grep -v "$INSTALL_DIR/sync-photos.sh" | crontab -
    
    # Remove installation and script
    rm -rf "$INSTALL_DIR"
    rm -f "$HOME/.local/bin/google-photos-backup"
    
    echo -e "${GREEN}Uninstallation complete!${NC}"
    echo "Note: Backup directory ($BACKUP_DIR) was not removed to preserve your photos."
    echo "You can manually remove it with: rm -rf $BACKUP_DIR"
}

# Main script logic
case "$1" in
    "install")
        check_dependencies
        install_gphotos_sync
        setup_cron
        ;;
    "uninstall")
        uninstall
        ;;
    "schedule")
        setup_cron
        ;;
    "manual-sync")
        manual_sync
        ;;
    *)
        usage
        ;;
esac
