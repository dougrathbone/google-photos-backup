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
- [ ] Implement State Management (`state.json` loading/saving)
- [ ] Implement Initial Sync Logic
- [ ] Implement Incremental Sync Logic
- [ ] Develop `installer.sh` script
- [ ] Create `systemd` service file
