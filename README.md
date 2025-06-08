# Google Photos Backup

A Node.js application to back up your Google Photos library to a local directory.

**Version:** 1.0.0 (Stable)

**Architecture:** Modular, fully tested codebase with comprehensive error handling and dependency injection.

## Important Note on API Limitations

Please be aware that due to Google Photos API policy changes implemented after March 31, 2025, the methods used by this tool to access the full photo library (`photoslibrary.readonly` scope and unrestricted `mediaItems.list`/`.search`) are **no longer officially supported by Google** for reading non-app-created data.

While the tool might partially function under certain circumstances, relying on it for a complete backup of your existing Google Photos library is **unsupported and may become unreliable or cease functioning** as Google enforces these policy changes.

This project is primarily maintained for **educational and development purposes** (demonstrating Node.js, API auth, file handling, etc.). It should not be used for critical backups of an entire existing Google Photos library due to these API constraints.

## Purpose (Original Goal - Now Limited by API Policy)

This tool *originally aimed* to provide a reliable way for users (primarily on Linux, but adaptable) to back up and synchronize their Google Photos library to a local directory. It's designed to run potentially as a background service, keeping a local copy reasonably up-to-date with the cloud library.

This addresses the need for:
*   Local backups of your Google Photos.
*   Offline access to your photos.
*   Integration with other local media workflows.

## Features

*   **Authentication:** Securely connects to Google Photos using OAuth 2.0.
*   **Configuration:** Uses a `config.json` file for settings (sync directory, credentials path, etc.).
*   **Logging:** Comprehensive logging system with centralized error handling using Winston.
*   **State Management:** Uses `state.json` to track sync progress and avoid re-downloads.
*   **Synchronization:** Supports both initial full download and incremental synchronization.
*   **Error Handling:** Centralized error management with standardized error types and severity levels.
*   **Modular Architecture:** Clean separation of concerns with dependency injection pattern.
*   **Testing:** Comprehensive test suite with 100% pass rate (183 tests across 14 test suites).
*   **Service Management:** Systemd integration with status monitoring and management commands.
*   **Lock Management:** Prevents concurrent runs and ensures data integrity.

## Architecture

The application follows a modular architecture with clear separation of concerns:

### Core Modules
*   **`src/google-synchroniser.js`** - Main application entry point and orchestration
*   **`src/environment.js`** - Environment detection, path resolution, and configuration loading  
*   **`src/logger.js`** - Centralized logger configuration and startup logging
*   **`src/errorHandler.js`** - Standardized error handling with types and severity levels
*   **`src/syncContext.js`** - Dependency injection container eliminating global variables

### Functional Modules
*   **`src/googleAuth.js`** - OAuth 2.0 authentication flow management
*   **`src/googlePhotosApi.js`** - Google Photos API interaction layer
*   **`src/syncManager.js`** - Synchronization orchestration (initial and incremental)
*   **`src/downloader.js`** - File download and local storage management
*   **`src/stateManager.js`** - Application state persistence and loading
*   **`src/statusUpdater.js`** - Status tracking and reporting
*   **`src/statusDisplay.js`** - Status display functionality for management commands

### Utility Modules
*   **`src/configLoader.js`** - Configuration file loading and validation
*   **`src/fileUtils.js`** - File system utility functions

### Quality Assurance
*   **100% Test Coverage**: All modules have comprehensive unit tests
*   **Error Handling**: Standardized error types (configuration, authentication, network, filesystem, API, lock)
*   **Dependency Injection**: No global variables, clean module boundaries
*   **Performance**: Optimized for memory usage and concurrent operations

## Development Setup

Follow these steps to set up your local development environment:

1.  **Prerequisites:**
    *   [Node.js](https://nodejs.org/) (LTS version recommended)
    *   [npm](https://www.npmjs.com/) (usually included with Node.js)
    *   Git

2.  **Clone the Repository:**
    ```bash
    git clone <repository-url> # Replace <repository-url> with the actual Git URL
    cd google-synchroniser
    ```

3.  **Install Dependencies:**
    ```bash
    npm install
    ```

4.  **Set up Google API Credentials:**
    *   Go to the [Google Cloud Console](https://console.cloud.google.com/).
    *   Create a new project or select an existing one.
    *   Enable the **Google Photos Library API** for your project.
    *   Go to "Credentials" and create new credentials:
        *   Select "OAuth client ID".
        *   Choose "Desktop app" as the Application type.
        *   Give it a name (e.g., "GPhotos Sync Desktop").
    *   Download the client secret JSON file.
    *   **Important:** Rename the downloaded file to `client_secret.json` (or match the filename you configure below) and place it in the **root directory** of this project.
    *   **DO NOT commit this `client_secret.json` file to Git.** The `.gitignore` file is configured to prevent this, but be careful.

5.  **Configure the Application:**
    *   A default `config.json` file is provided in the root directory.
    *   Review and potentially edit the paths within `config.json`:
        *   `localSyncDirectory`: Where your photos will be downloaded (default: `./gphotos_backup`).
        *   `syncIntervalHours`: How often to check for new photos (default: `6`).
        *   `credentialsPath`: Path to your downloaded **client secret** file (default: `./client_secret.json`). **Make sure this matches the file you downloaded and renamed in the previous step.**
        *   `logFilePath`: Path for the application log file (default: `./gphotos_sync.log`).
        *   `stateFilePath`: Path for the file that will store synchronization state (default: `./sync_state.json`).
        *   `debugMaxPages` (Optional): Set to an integer > 0 to limit pages fetched during *initial sync*. Defaults to `0` (no limit).
        *   `debugMaxDownloads` (Optional): Set to an integer > 0 to limit the total number of files downloaded per run (initial or incremental). Useful for testing without downloading everything. Defaults to `0` (no limit).
        *   `continuousMode` (Optional): Set to `true` to run the application continuously, performing an incremental sync approximately every 5 minutes after the initial sync. If `false` (default), the application runs once and exits. This is typically used when installing as a long-running service instead of using a scheduled timer.
    *   The application automatically resolves these paths relative to the project root.

## Running the Application

Once set up, you can run the application using either:

```bash
npm start
```

or

```bash
node run.js
```

**First Run - Authentication:**

When you run the application for the *first time*, you will need to authorize it to access your Google Photos:

1.  The application will detect that it's not yet authorized.
2.  It will print an authorization URL to the console.
3.  It will attempt to open this URL in your default web browser.
4.  Log in to your Google account if prompted.
5.  Review the permissions requested (it should only ask for read-only access to Google Photos).
6.  Grant permission.
7.  Google will show you an **authorization code**. Copy this code.
8.  Paste the code back into the terminal when prompted by the application.
9.  The application will exchange the code for access/refresh tokens and save them to `credentials.js` in the project root (this file is also ignored by Git).

Subsequent runs should automatically use the saved tokens in `credentials.js` without requiring you to re-authenticate.

## Running Tests

The application includes a comprehensive test suite with 100% pass rate. Tests are written using [Jest](https://jestjs.io/).

### Running All Tests
```bash
npm test
```

### Test Coverage
The test suite includes 183 tests across 14 test suites covering:
- **Unit Tests**: Every module has dedicated test coverage
- **Integration Tests**: End-to-end functionality verification  
- **Error Scenarios**: Comprehensive error handling validation
- **Edge Cases**: Boundary conditions and invalid inputs
- **Mocking**: Proper isolation of external dependencies

### Test Statistics
- **Test Suites**: 14 (100% passing)
- **Total Tests**: 183 (100% passing)  
- **Coverage**: All modules have comprehensive test coverage
- **Error Handling**: All error paths tested
- **Performance**: Tests run in under 2 seconds

### Running Specific Tests
```bash
# Run specific test file
npm test -- tests/syncManager.test.js

# Run tests with verbose output
npm test -- --verbose

# Run tests in watch mode during development
npm test -- --watch
```

## Installation (Linux with systemd - System-Wide)

An installer script is provided to set up the application as a system-wide service managed by systemd.

**Requirements:**
*   Linux system with `systemd`.
*   `sudo` or root privileges to run the installer.
*   `node`, `npm`, `git` installed.

**Steps:**

1.  **Clone the Repository:**
    ```bash
    git clone <repository-url> # Replace <repository-url> with the actual Git URL
    cd google-synchroniser
    ```

2.  **Make Installer Executable:**
    ```bash
    chmod +x installer.sh
    ```

3.  **Run Installer with Sudo:**
    ```bash
    sudo ./installer.sh
    ```

4.  **Follow Prompts:** The installer will:
    *   Check dependencies.
    *   Ask you to choose a synchronization schedule (**Hourly**, **Daily**, **Weekly**, or **Continuous**).
    *   Create a dedicated system user/group (`gphotosync`).
    *   Create necessary directories:
        *   App Code: `/opt/google-photos-backup`
        *   Config: `/etc/google-photos-backup`
        *   Data/State: `/var/lib/google-photos-backup`
        *   Logs: `/var/log/google-photos-backup`
    *   Install Node.js dependencies.
    *   Generate a default `config.json` in `/etc/google-photos-backup/`.
    *   Create a management wrapper script: `/usr/local/bin/google-photos-backup`.
    *   Create systemd service (`/etc/systemd/system/google-photos-backup.service`) and timer (`*.timer`, if scheduled) files.
    *   Enable the systemd service/timer.
    *   Create an uninstaller script: `/usr/local/sbin/uninstall-google-photos-backup`.

5.  **Place Credentials:**
    *   Go to the [Google Cloud Console](https://console.cloud.google.com/) and download your **OAuth client ID** credentials JSON file (select "Desktop app" type).
    *   Copy the downloaded file into the configuration directory:
        ```bash
        sudo cp /path/to/your/downloaded_credentials.json /etc/google-photos-backup/client_secret.json
        ```
    *   **Set correct ownership and permissions:**
        ```bash
        sudo chown root:gphotosync /etc/google-photos-backup/client_secret.json
        sudo chmod 640 /etc/google-photos-backup/client_secret.json
        ```

6.  **Manual First Run (IMPORTANT for Authentication):**
    *   Before the service/timer can run successfully, you **must** run the application manually **once as the service user** to perform the initial Google Account authorization (OAuth flow).
    *   Execute the following command in your terminal:
        ```bash
        sudo -u gphotosync NODE_ENV=production node /opt/google-photos-backup/src/google-synchroniser.js
        ```
    *   Follow the on-screen instructions:
        *   Copy the authorization URL provided.
        *   Open the URL in a web browser.
        *   Log in to your Google Account.
        *   Grant the requested permissions (should be read-only access).
        *   Copy the authorization code provided by Google.
        *   Paste the code back into the terminal when prompted.
    *   The application will save the necessary tokens in the state file (`/var/lib/google-photos-backup/sync_state.json`).

7.  **Start/Enable Service/Timer:**
    *   The installer already enables the service or timer to start on boot.
    *   **Continuous Mode:** If you chose continuous mode, you may need to start the service manually the first time after authorization:
        ```bash
        sudo systemctl start google-photos-backup.service
        ```
    *   **Scheduled Mode:** The timer will automatically trigger the service according to the schedule (e.g., hourly, daily). To trigger the *first* sync immediately after authorization:
        ```bash
        sudo google-photos-backup sync
        ```

## Managing the Service

Once installed, use the `google-photos-backup` command (available in your PATH) to manage the application:

*   **Check Status:** Shows comprehensive status information including application state, last sync details, service status, and timer status.
    ```bash
    google-photos-backup status
    ```
    
    Output includes:
    - Application state (idle, running, failed, etc.)
    - Last successful sync timestamp  
    - Last run outcome and statistics
    - Any error messages
    - Systemd service state and timer information
    - Next scheduled run time

*   **Trigger Manual Sync (Scheduled Mode):** Starts the systemd service once.
    ```bash
    sudo google-photos-backup sync
    ```

*   **View Live Logs:** Follows the logs being written by the service via journald.
    ```bash
    google-photos-backup logs
    ```
    
    Additional log options:
    ```bash
    google-photos-backup logs --follow    # Follow logs in real-time
    google-photos-backup logs --lines 100 # Show last 100 lines
    ```

*   **Update:** Provides instructions for manual update.
    ```bash
    google-photos-backup update
    ```

*   **Uninstall:** Runs the uninstaller script (requires sudo).
    ```bash
    sudo google-photos-backup uninstall
    ```

### Status Information

The status command provides detailed information about:
- **Application State**: Current operation status (idle, sync running, error, etc.)
- **Sync History**: Last successful sync time and outcome
- **Performance Metrics**: Items downloaded, sync duration
- **Service Health**: Systemd service and timer status
- **Error Details**: Any recent errors or warnings
- **Scheduling**: Next planned sync execution time

## Configuration

After installation, the main configuration file is located at:
`/etc/google-photos-backup/config.json`

You can edit this file (using `sudo`) to change settings like:
*   `localSyncDirectory`: Where photos are downloaded.
*   `debugMaxPages`, `debugMaxDownloads`: For debugging/testing.

**Important:** Do not change the `credentialsPath`, `logFilePath`, `stateFilePath`, or `statusFilePath` unless you understand the implications, as the application relies on these standard paths when run by the service.

## Files and Directories

*   `/opt/google-photos-backup`: Application source code.
*   `/etc/google-photos-backup`: Configuration files (`config.json`, `client_secret.json`).
*   `/var/lib/google-photos-backup`: Application data (state file `sync_state.json`, status file `status.json`, lock file).
*   `/var/log/google-photos-backup`: Log files (`gphotos_sync.log`, `error.log`, etc.).
*   `/usr/local/bin/google-photos-backup`: Management command script.
*   `/etc/systemd/system/google-photos-backup.service`: Systemd service definition.
*   `/etc/systemd/system/google-photos-backup.timer`: Systemd timer definition (if using scheduled sync).
*   `/usr/local/sbin/uninstall-google-photos-backup`: Uninstaller script.

## Updating the Application

Currently, the `google-photos-backup update` command only provides manual instructions. To update:

1.  Navigate to the directory where you originally cloned the source code repository.
2.  Pull the latest changes: `git pull origin main` (or your branch).
3.  Re-run the installer:
    ```bash
    sudo ./installer.sh
    ```
    The installer should handle copying new files and restarting services if necessary (though you may be prompted).

## Uninstalling the Application

Use the management command:
```bash
sudo google-photos-backup uninstall
```
Follow the prompts. It will stop services, remove files/directories, and optionally remove the service user/group.

**Warning:** Carefully read the prompts during uninstallation, especially regarding the removal of configuration, data, and log directories, as this can be destructive.

## Concurrency

The application uses a lock file located within `/var/lib/google-photos-backup/` to prevent multiple instances from running simultaneously, whether triggered manually or by the systemd service/timer.



## Development Setup

(Instructions for setting up a local development environment remain largely the same, but note that running `npm start` will use development paths for config/logs/state relative to the project root, not the system-wide paths.)