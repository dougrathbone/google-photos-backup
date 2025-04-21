# Google Photos Synchroniser (`gphotos-sync-node`)

A Node.js application to synchronize your Google Photos library to a local directory.

**Version:** 0.1 (In Development)

**Note:** This project is currently under active development.

## ⚠️ Important Warning: API Policy Changes ⚠️

**As of March 31, 2025, Google Photos API policy changes prevent applications from accessing a user's full photo library using the methods employed by this tool.** 

Specifically, the necessary read-only scopes have been removed, and API calls to list/search media items are restricted to only items created *by this application*.

**What this means:**
*   This tool, in its current form, **cannot reliably back up or synchronize your entire existing Google Photos library.** It relies on API behavior that is no longer officially supported.
*   While it might *appear* to partially work under certain conditions (e.g., during Google's gradual enforcement rollout or with newly uploaded photos), this functionality **may break completely at any time without notice.**
*   Using this tool for full library backup purposes is **unsupported and potentially unreliable.**

This project is maintained here primarily for educational/demonstration purposes of interacting with Node.js, API authentication, file handling, etc., but it **should not be relied upon for critical backups** of your complete Google Photos library due to these API limitations.

## Purpose (Original Goal - Now Limited by API Policy)

This tool *originally aimed* to provide a reliable way for users (primarily on Linux, but adaptable) to back up and synchronize their Google Photos library to a local directory. It's designed to run potentially as a background service, keeping a local copy reasonably up-to-date with the cloud library.

This addresses the need for:
*   Local backups of your Google Photos.
*   Offline access to your photos.
*   Integration with other local media workflows.

## Features (Current & Planned)

*   **Authentication:** Securely connects to Google Photos using OAuth 2.0.
*   **Configuration:** Uses a `config.json` file for settings (sync directory, credentials path, etc.).
*   **Logging:** Logs events and errors to console and a file (`gphotos_sync.log` by default) using Winston.
*   **State Management (Planned):** Will use `state.json` to track sync progress and avoid re-downloads.
*   **Synchronization (Planned):** Will implement initial full download and subsequent incremental synchronization.
*   **Testing:** Includes unit tests using Jest.

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

Unit tests are written using [Jest](https://jestjs.io/). To run the test suite:

```bash
npm test
```

This command will execute all tests located in the `tests/` directory.

## Installation (Linux with systemd)

An installer script is provided to set up the application and run it periodically as a systemd user service.

1.  **Make Installer Executable:**
    ```bash
    chmod +x installer.sh
    ```
2.  **Run Installer:**
    ```bash
    ./installer.sh
    ```
3.  **Follow Prompts:** The installer will ask you to choose a synchronization schedule (Hourly, Daily, Weekly, or **Continuous**).
4.  **Place Credentials:** AFTER the installer completes, copy your downloaded `client_secret.json` file into the configuration directory shown by the installer (usually `~/.config/gphotos-sync-node/`).
5.  **Manual First Run (IMPORTANT):** BEFORE starting the timer OR service, you MUST run the application manually once from your terminal to perform the initial Google Account authorization (OAuth flow). The installer will print the command (e.g., `cd ~/.local/share/gphotos-sync-node && ./run.js`). Follow the on-screen instructions to copy the URL, authorize in your browser, and paste the code back into the terminal.
6.  **Start Timer or Service:** Once authorized:
    *   If you chose **Hourly, Daily, or Weekly**, start the **timer**: 
        ```bash
        systemctl --user start gphotos-sync-node.timer
        ```
    *   If you chose **Continuous**, start the **service** directly:
        ```bash
        systemctl --user start gphotos-sync-node.service
        ```

Your photos will now synchronize based on the schedule you selected. You can check the status and logs using the `systemctl --user` and `journalctl --user` commands provided by the installer.

## Concurrency

The application uses a lock file (`gphotos-sync.lock` in the config directory) to prevent multiple instances from running simultaneously if the timer triggers a new run before the previous one has finished. 