# Project Plan: Google Photos Synchroniser/Backup

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
