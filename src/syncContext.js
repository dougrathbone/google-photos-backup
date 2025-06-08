const { createStatusUpdater } = require('./statusUpdater');

/**
 * SyncContext - Encapsulates shared state and dependencies for the sync process
 * This class eliminates global variables and provides a clean dependency injection pattern
 */

class SyncContext {
    constructor(config, logger, errorHandler, statusUpdaterOrPath = null) {
        // Core dependencies
        this.config = config;
        this.logger = logger;
        this.errorHandler = errorHandler;
        
        // Handle statusUpdater - either instance or path to create one
        if (typeof statusUpdaterOrPath === 'string') {
            // Create new StatusUpdater instance with provided path
            this.statusUpdater = createStatusUpdater(statusUpdaterOrPath, logger);
            this._statusUpdaterCreated = true;
        } else if (statusUpdaterOrPath && typeof statusUpdaterOrPath === 'object') {
            // Use provided statusUpdater instance (backward compatibility)
            this.statusUpdater = statusUpdaterOrPath;
            this._statusUpdaterCreated = false;
        } else {
            // No status updater provided
            this.statusUpdater = null;
            this._statusUpdaterCreated = false;
        }
        
        // Environment info
        this.isProduction = process.env.NODE_ENV === 'production';
        this.lockFilePath = null;
        this.releaseLock = null;
        
        // Runtime state
        this.authResult = null;
        this.currentState = null;
        this.syncStartTime = null;
        
        // Validate required dependencies (allow missing errorHandler during construction)
        this.validateDependencies(true);
    }

    /**
     * Initializes the SyncContext, including any created StatusUpdater
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._statusUpdaterCreated && this.statusUpdater) {
            await this.statusUpdater.initialize();
        }
    }

    /**
     * Validates that all required dependencies are provided
     * @param {boolean} allowMissingErrorHandler - Whether to allow missing errorHandler (for delayed initialization)
     * @throws {Error} If any required dependency is missing
     */
    validateDependencies(allowMissingErrorHandler = false) {
        const required = ['config', 'logger'];
        if (!allowMissingErrorHandler) {
            required.push('errorHandler');
        }
        const missing = required.filter(dep => !this[dep]);
        
        if (missing.length > 0) {
            throw new Error(`SyncContext missing required dependencies: ${missing.join(', ')}`);
        }
        
        // Warn about missing errorHandler if allowed but missing
        if (allowMissingErrorHandler && !this.errorHandler) {
            this.logger.warn('SyncContext created without errorHandler - will be set during initialization');
        }
        
        // StatusUpdater is optional but should be created if needed
        if (!this.statusUpdater) {
            this.logger.warn('SyncContext created without statusUpdater - status tracking will be disabled');
        }
    }

    /**
     * Sets the error handler (for delayed initialization)
     * @param {ErrorHandler} errorHandler - The error handler instance
     */
    setErrorHandler(errorHandler) {
        this.errorHandler = errorHandler;
        // Re-validate now that errorHandler is set
        this.validateDependencies(false);
    }

    /**
     * Sets the lock file path and release function
     * @param {string} lockFilePath - Path to the lock file
     * @param {Function} releaseLock - Function to release the lock
     */
    setLockInfo(lockFilePath, releaseLock) {
        this.lockFilePath = lockFilePath;
        this.releaseLock = releaseLock;
    }

    /**
     * Sets the authentication result
     * @param {object} authResult - Authentication result containing accessToken and client
     */
    setAuthResult(authResult) {
        this.authResult = authResult;
    }

    /**
     * Sets the current sync state
     * @param {object} currentState - Current state object
     */
    setCurrentState(currentState) {
        this.currentState = currentState;
    }

    /**
     * Gets the access token from auth result
     * @returns {string|null} Access token or null if not available
     */
    getAccessToken() {
        return this.authResult?.accessToken || null;
    }

    /**
     * Gets the auth client from auth result
     * @returns {object|null} Auth client or null if not available
     */
    getAuthClient() {
        return this.authResult?.client || null;
    }

    /**
     * Gets the last sync timestamp from current state
     * @returns {string|null} Last sync timestamp or null
     */
    getLastSyncTimestamp() {
        return this.currentState?.lastSyncTimestamp || null;
    }

    /**
     * Updates the last sync timestamp in current state
     * @param {string} timestamp - New timestamp to set
     */
    updateLastSyncTimestamp(timestamp) {
        if (!this.currentState) {
            this.currentState = {};
        }
        this.currentState.lastSyncTimestamp = timestamp;
    }

    /**
     * Releases the lock if available
     * @returns {Promise<boolean>} True if lock was released or no lock to release
     */
    async releaseLockSafely() {
        if (this.releaseLock) {
            try {
                await this.releaseLock();
                this.logger.info('Lock released successfully');
                return true;
            } catch (error) {
                this.logger.warn('Failed to release lock:', error.message);
                return false;
            }
        }
        this.logger.debug('No lock to release');
        return true;
    }

    /**
     * Validates that authentication is available
     * @throws {Error} If authentication is not available
     */
    requireAuth() {
        if (!this.authResult || !this.authResult.accessToken) {
            throw this.errorHandler.createAuthenticationError('Authentication required but not available');
        }
    }

    /**
     * Validates that state is loaded
     * @throws {Error} If state is not loaded
     */
    requireState() {
        if (!this.currentState) {
            throw this.errorHandler.createConfigurationError('State required but not loaded');
        }
    }
}

module.exports = { SyncContext }; 