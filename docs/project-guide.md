**Project Name:** `gphotos-sync-node`

**Version:** 0.1 (Initial Draft)

**Date:** 2025-04-20

**1. Introduction & Purpose**

This document outlines the requirements for a new Linux application, `gphotos-sync-linux`. The primary purpose of this application is to provide a reliable way for users to back up and synchronize their Google Photos library to a local directory on their Linux machine. It aims to run unobtrusively in the background as a service, ensuring the local copy stays reasonably up-to-date with the cloud library. This addresses the need for local backups, offline access, and potential integration with other local media workflows.

**IMPORTANT NOTE (April 2025):** Due to significant changes in the Google Photos Library API policy effective March 31, 2025, applications like this can no longer reliably access a user's full photo library for backup/sync purposes using the `photoslibrary.readonly` scope or equivalent methods. API access is now restricted primarily to media items created *by the application itself*. Therefore, this project, while demonstrating various technical concepts, **should only be considered for development, educational, or testing purposes in its current form.** It cannot fulfill the original goal of a complete library backup via the Library API.

**2. Goals**

* **Connect & Authenticate:** Securely connect to a user's Google Photos account using the Google Photos API.
* **Download Media:** Download photos and videos from the user's library.
* **Local Storage:** Store downloaded media in a user-specified local directory.
* **Synchronization:** Implement logic to periodically check for new media in Google Photos and download only the new items since the last sync.
* **Configuration:** Allow users to configure key parameters via a JSON file (e.g., local directory path, sync frequency).
* **State Persistence:** Maintain the synchronization state between runs to avoid re-downloading existing media.
* **Background Operation:** Run as a systemd service on Linux.
* **Easy Installation:** Provide a simple bash script for installation.

**3. Target Audience**

* Linux users who use Google Photos.
* Users who desire a local backup of their Google Photos library.
* Users comfortable with configuring applications via text files and potentially interacting with the command line for initial setup/authentication.

**4. Functional Requirements**

* **Authentication:**
    * Must use OAuth 2.0 to authenticate with the Google Photos API.
    * Requires a mechanism for the user to grant initial permission: the application will print an authorization URL to the console. The user must visit this URL in a browser, grant permission, and then paste the resulting authorization code back into the application when prompted.
    * Credentials (OAuth tokens) must be stored securely (e.g., in the file specified by `stateFilePath` with restricted permissions).
* **Configuration (`config.json`):**
    * Must read configuration from a `config.json` file.
    * Minimum configurable parameters:
        * `localSyncDirectory`: Path to the local folder where media will be stored.
        * `syncIntervalHours`: Frequency (in hours) at which to check for new media.
        * `credentialsPath`: Path to the stored API credentials/token file.
        * `logFilePath`: Path to the log file.
        * `stateFilePath`: Path to the synchronization state file.
* **Synchronization Logic:**
    * **Initial Sync:** On the first run (or when the state file is missing), scan the entire Google Photos library (respecting API limits) and download all media items.
    * **Incremental Sync:** On subsequent runs, query the Google Photos API for media added since the last successful sync timestamp and download only those new items.
    * Must handle potential API pagination.
    * Downloads should retrieve the original, unmodified media bytes whenever possible (including RAW image formats). Videos should be downloaded at original quality.
* **State Management (`state.json`):**
    * Must store the timestamp of the last successful synchronization check.
    * Must store identifiers of successfully downloaded media items to prevent duplicates and potentially aid recovery (though the primary mechanism for incremental sync should be the timestamp).
    * The state file must be read at startup and updated upon successful completion of a sync cycle.
* **Logging:**
    * Log major events (startup, sync start/end, number of items downloaded) and errors to the specified `logFilePath`.
    * Include timestamps in log entries.
* **Installation (`installer.sh`):**
    * Checks for dependencies (Node.js, npm).
    * Creates necessary directories (e.g., for config, logs, state, application code).
    * Copies application files to a designated location (e.g., `/opt/gphotos-sync-linux` or `~/.local/share/gphotos-sync-linux`).
    * Copies the `gphotos-sync-linux.service` file to the appropriate systemd directory (e.g., `/etc/systemd/system/` or `~/.config/systemd/user/`).
    * Enables and optionally starts the systemd service.
* **Service File (`gphotos-sync-linux.service`):**
    * Defines how to run the Node.js application as a service.
    * Specifies the user to run as (if applicable).
    * Ensures the service restarts on failure (with reasonable limits).
    * Specifies dependency on network being available.

**5. Non-Functional Requirements**

* **Reliability:** The application should handle common errors gracefully (e.g., network interruptions, API rate limits, API errors) and retry synchronization attempts where appropriate.
* **Performance:** Should be mindful of Google Photos API rate limits and query efficiently. Downloads should not consume excessive system resources.
* **Security:** API credentials (OAuth tokens) must be stored securely (e.g., with restricted file permissions, potentially outside the main config file). Avoid logging sensitive information.
* **Maintainability:** Code should be well-structured, commented where necessary, and follow Node.js best practices.
* **Testability:** All core logic (configuration, authentication, state management, API interaction, synchronization) should be unit tested using Jest. New features or significant refactors must include corresponding unit tests. All tests must pass before moving to the next development step.
* **API Limitations:** Be aware that the Google Photos Library API may have limitations regarding the download of original quality files (especially RAW photos and unmodified videos). The application should download the best available version via the API, but it might not always be the true original file uploaded by the user.

**6. Technology Stack**

* **Language/Runtime:** Node.js (specify version if important, e.g., LTS)
* **Configuration:** JSON (`config.json`)
* **State Persistence:** JSON (`state.json`)
* **Installation:** Bash script (`installer.sh`)
* **Service Management:** systemd (`.service` file)
* **Key Libraries (Expected):**
    * Google APIs Node.js Client (`googleapis`) for interacting with the Photos API.
    * Node.js built-in `fs` module for file system operations.
    * A logging library (e.g., Winston, pino) is recommended.

**7. Future Considerations (Out of Scope for v0.1)**

* Two-way synchronization (uploading local files).
* Handling deletions (removing local files when deleted from Google Photos, or vice-versa).
* Downloading specific albums or based on date ranges.
* Graphical User Interface (GUI).
* Support for Shared Albums.
* More sophisticated error handling and retry logic.
* Executable packaging (e.g., using `pkg`).

---

**Questions to Refine Requirements:**

To make this PRD even more useful for code generation, please consider these points:

2.  **Local Folder Structure:** How should the downloaded photos and videos be organized within the `localSyncDirectory`?
    * a) Flat structure (all files directly in the directory)?
    * b) Organized by date (e.g., `YYYY/MM/DD/filename.jpg`)?
    * c) Organized by Album (this adds complexity as items can be in multiple albums)? - Current implementation uses root for non-album items and subdirs for albums.
3.  **Filename Conflicts:** How should potential filename conflicts be handled if Google Photos allows duplicate filenames (though media items have unique IDs)? (e.g., Append ID? Add a counter?)
4.  **Specific Sync Logic:** Should the incremental sync rely purely on querying for items newer than the `lastSyncTimestamp`, or should it also cross-reference against the `downloadedMediaIds` in `state.json` just in case? (Timestamp is usually sufficient and more efficient).
5.  **Handling Deletions:** For this initial version, we are explicitly *not* handling deletions. Is that correct? (i.e., if a user deletes a photo in Google Photos, the local copy remains).
6.  **Error Handling Specifics:** Any specific requirements for retries? (e.g., How many times to retry on network error? How long to wait between retries?)
7.  **Logging Level:** Should the logging level (e.g., INFO, DEBUG, WARN, ERROR) be configurable?
8.  **Installation Scope:** Should the installer target a system-wide installation (requiring root/sudo, installing to `/etc/systemd/system`, `/opt/`) or a user-specific installation (installing to `~/.config/systemd/user/`, `~/.local/share/`)? User-specific is often easier and safer.
10. **API Credentials Storage:** While `credentialsPath` is in `config.json`, the *actual* token file should likely have restricted permissions. Should the installer script attempt to set these permissions (e.g., `chmod 600`)?

Once you provide answers or preferences for these questions, we can refine the PRD further, making it a stronger guide for Gemini.