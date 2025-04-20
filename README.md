# Google Photos Synchroniser (`gphotos-sync-node`)

A Node.js application to synchronize your Google Photos library to a local directory.

**Version:** 0.1 (In Development)

**Note:** This project is currently under active development. Core synchronization logic is not yet fully implemented.

## Purpose

This tool aims to provide a reliable way for users (primarily on Linux, but adaptable) to back up and synchronize their Google Photos library to a local directory. It's designed to run potentially as a background service, keeping a local copy reasonably up-to-date with the cloud library.

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
        *   `debugMaxPages` (Optional): Set to an integer greater than 0 to limit the number of pages fetched for albums and media items during the *initial sync*. Useful for debugging or testing without fetching the entire library. Defaults to `0` (no limit).
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