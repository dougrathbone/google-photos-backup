# Project Plan: Google Photos Backup

## Initial Setup

- [x] Create basic structure for `google-synchroniser.js`.
- [x] Implement configuration loading from `config.json`.
- [x] Refactor config loading to `src/configLoader.js`.
- [x] Set up Winston logging in `src/google-synchroniser.js`.
- [x] Set up Jest testing framework.
- [x] Add unit test for `configLoader` (`tests/configLoader.test.js`).
- [x] Create `tests/testing-guide.md`.
- [x] Update `package.json` with test and start scripts.

## Next Steps

- [x] Implement Google Photos API Authentication (OAuth 2.0)
- [x] Add unit tests for `configLoader`, `fileUtils`, `googlePhotosApi`, `googleAuth`.
- [x] Implement State Management (`state.json` loading/saving) (`src/stateManager.js`).
- [x] Add unit tests for `stateManager`.
- [x] Implement Initial Sync Logic (`src/syncManager.js`, `src/downloader.js`).
- [x] Add unit tests for `downloader`, `syncManager`, and `getAllMediaItems`.
- [x] Implement Incremental Sync Logic (`src/syncManager.js`, `src/googlePhotosApi.js`).
- [x] Add unit tests for incremental sync.
- [x] Develop `installer.sh` script (user-specific installation).
- [x] Create `gphotos-sync-node.service` template (installer generates final file).

## Refactor for Global Installation & Management

- [x] Determine standard Linux directory structure for installation.
- [x] Modify `installer.sh` to use standard directories (`/opt`, `/etc`, `/var/lib`, `/var/log`, `/usr/local/bin`).
- [x] Create a wrapper script (`/usr/local/bin/google-photos-backup`) for status, update, uninstall commands.
- [x] Update `google-synchroniser.js` to correctly locate files in new standard paths (config, state, log).
- [x] Update systemd service file (`google-photos-backup.service`) for new paths and execution method (handled dynamically in installer).
- [x] Update documentation (`README.md`, etc.) with new installation details and management commands.
- [x] Update `project-guide.md` with new installation details.
- [ ] Update other documentation (`README.md`) with new installation details and management commands.
