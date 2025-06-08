const fs = require('fs').promises;
const path = require('path');

const STATUS_FILENAME = 'sync_status.json';

// Initial/default status structure
const defaultStatus = {
    status: 'idle',
    pid: null,
    currentRunStartTimeISO: null,
    currentRunTotalItems: 0,
    currentRunItemsDownloaded: 0,
    lastSyncTimestamp: null, // Will be updated from main state
    lastRunSummary: 'Never run.'
};

/**
 * StatusUpdater class - stateless status management
 * All state is explicitly passed through constructor and method parameters
 */
class StatusUpdater {
    constructor(statusFilePath, logger) {
        this.statusFilePath = statusFilePath;
        this.logger = logger;
        this.pendingWrites = 0;
        this.writeInterval = 10; // Write status every 10 download increments
        this.currentStatus = { ...defaultStatus };
        this.initialized = false;
    }

    /**
     * Initializes the status updater by loading existing status or creating defaults.
     * @returns {Promise<void>}
     */
    async initialize() {
        if (!this.statusFilePath || typeof this.statusFilePath !== 'string') {
            if (this.logger) {
                this.logger.error('Invalid status file path provided to StatusUpdater.');
            }
            this.currentStatus = { ...defaultStatus };
            this.initialized = false;
            return;
        }

        this.logger.debug(`Status file path set to: ${this.statusFilePath}`);
        
        try {
            const fileContent = await fs.readFile(this.statusFilePath, 'utf8');
            this.currentStatus = JSON.parse(fileContent);
            
            // Reset potentially stale running status on init
            if (this.currentStatus.status?.startsWith('running')) {
                this.logger.warn(`Found stale 'running' status in ${this.statusFilePath} on startup. Resetting to 'idle'.`);
                this.currentStatus.status = 'idle';
                this.currentStatus.pid = null;
                await this.writeStatusToFile(); // Write cleaned status back
            }
            
            this.logger.info('Loaded existing status file.');
        } catch (err) {
            if (err.code === 'ENOENT') {
                this.logger.info('Status file not found, initializing with default status.');
                this.currentStatus = { ...defaultStatus };
                await this.writeStatusToFile(); // Create the initial file
            } else {
                this.logger.error(`Error loading status file ${this.statusFilePath}, using defaults: ${err.message}`);
                this.currentStatus = { ...defaultStatus };
                // Don't write back if loading failed for other reasons
            }
        }
        
        this.initialized = true;
    }

    /**
     * Writes the current status object to the file.
     * @private
     */
    async writeStatusToFile() {
        if (!this.statusFilePath) {
            this.logger.error('Status file path not initialized. Cannot write status.');
            return;
        }
        
        try {
            const statusString = JSON.stringify(this.currentStatus, null, 2);
            await fs.writeFile(this.statusFilePath, statusString, 'utf8');
            this.logger.debug(`Status file updated: ${this.statusFilePath}`);
        } catch (err) {
            this.logger.error(`Failed to write status file ${this.statusFilePath}: ${err.message}`);
        }
    }

    /**
     * Updates specific fields in the status and writes to the file.
     * @param {object} updates - An object containing fields to update.
     * @returns {Promise<void>}
     */
    async updateStatus(updates) {
        if (!this.initialized) {
            if (this.logger) {
                this.logger.error('StatusUpdater not initialized. Call initialize() first.');
            }
            // Still update in-memory status for backward compatibility
            this.currentStatus = { ...this.currentStatus, ...updates };
            return;
        }
        
        this.currentStatus = { ...this.currentStatus, ...updates };
        await this.writeStatusToFile();
    }

    /**
     * Sets the status to indicate the start of a sync run.
     * @param {'initial' | 'incremental'} runType - The type of sync run.
     * @param {number} totalItems - The total number of items to process in this run.
     * @param {string | null} lastSync - The timestamp of the previous sync.
     * @returns {Promise<void>}
     */
    async setSyncStartStatus(runType, totalItems, lastSync) {
        await this.updateStatus({
            status: `running:${runType}`,
            pid: process.pid,
            currentRunStartTimeISO: new Date().toISOString(),
            currentRunTotalItems: totalItems,
            currentRunItemsDownloaded: 0,
            lastSyncTimestamp: lastSync // Update last sync time at start
        });
    }

    /**
     * Increments the count of downloaded items in the status.
     * Writes update periodically to avoid excessive writes.
     * @returns {Promise<void>}
     */
    async incrementDownloadedCount() {
        if (!this.initialized) {
            this.logger.error('StatusUpdater not initialized. Call initialize() first.');
            return;
        }
        
        this.currentStatus.currentRunItemsDownloaded++;
        this.pendingWrites++;
        
        if (this.pendingWrites >= this.writeInterval || 
            this.currentStatus.currentRunItemsDownloaded === this.currentStatus.currentRunTotalItems) {
            await this.writeStatusToFile();
            this.pendingWrites = 0;
        }
    }

    /**
     * Sets the status to indicate the end of a sync run (success or failure).
     * @param {boolean} success - Whether the run was successful.
     * @param {string} summary - A summary message of the run.
     * @returns {Promise<void>}
     */
    async setSyncEndStatus(success, summary) {
        await this.updateStatus({
            status: success ? 'idle' : 'failed',
            pid: null,
            lastRunSummary: summary
        });
    }

    /**
     * Sets the status explicitly to idle (e.g., on clean exit).
     * @returns {Promise<void>}
     */
    async setIdleStatus() {
        // Only update if not already idle to avoid unnecessary writes
        if (this.currentStatus.status !== 'idle') {
            await this.updateStatus({
                status: 'idle',
                pid: null
            });
        }
    }

    /**
     * Gets the current status (read-only copy).
     * @returns {object} Current status object
     */
    getCurrentStatus() {
        return { ...this.currentStatus };
    }

    /**
     * Gets the status file path.
     * @returns {string|null} The status file path
     */
    getStatusFilePath() {
        return this.statusFilePath;
    }
}

// Factory function for creating StatusUpdater instances
function createStatusUpdater(statusFilePath, logger) {
    return new StatusUpdater(statusFilePath, logger);
}

// Backward compatibility - legacy module-level functions
// These are deprecated and should be replaced with class-based approach
let globalStatusUpdater = null;

async function initializeStatus(fullStatusPath, logger) {
    globalStatusUpdater = new StatusUpdater(fullStatusPath, logger);
    await globalStatusUpdater.initialize();
}

async function updateStatus(updates, logger) {
    if (!globalStatusUpdater) {
        logger.error('Status updater not initialized. Call initializeStatus first.');
        // For backward compatibility, create a temporary uninitialized status updater
        // This allows tests to still update in-memory status
        globalStatusUpdater = new StatusUpdater(null, logger);
        globalStatusUpdater.currentStatus = { ...defaultStatus };
        globalStatusUpdater.initialized = false;
    }
    await globalStatusUpdater.updateStatus(updates);
}

async function setSyncStartStatus(runType, totalItems, lastSync, logger) {
    if (!globalStatusUpdater) {
        logger.error('Status updater not initialized. Call initializeStatus first.');
        return;
    }
    await globalStatusUpdater.setSyncStartStatus(runType, totalItems, lastSync);
}

async function incrementDownloadedCount(logger) {
    if (!globalStatusUpdater) {
        logger.error('Status updater not initialized. Call initializeStatus first.');
        return;
    }
    await globalStatusUpdater.incrementDownloadedCount();
}

async function setSyncEndStatus(success, summary, logger) {
    if (!globalStatusUpdater) {
        logger.error('Status updater not initialized. Call initializeStatus first.');
        return;
    }
    await globalStatusUpdater.setSyncEndStatus(success, summary);
}

async function setIdleStatus(logger) {
    if (!globalStatusUpdater) {
        logger.error('Status updater not initialized. Call initializeStatus first.');
        return;
    }
    await globalStatusUpdater.setIdleStatus();
}

module.exports = { 
    // New class-based approach (preferred)
    StatusUpdater,
    createStatusUpdater,
    
    // Legacy module-level functions (deprecated but maintained for compatibility)
    initializeStatus, 
    updateStatus, 
    setSyncStartStatus,
    incrementDownloadedCount,
    setSyncEndStatus,
    setIdleStatus,
    
    // Constants and testing utilities
    STATUS_FILENAME,
    defaultStatus,
    
    // Export internal state ONLY for testing (legacy):
    _getStatusFilePath: () => globalStatusUpdater?.getStatusFilePath() || null,
    _getCurrentStatus: () => globalStatusUpdater?.getCurrentStatus() || { ...defaultStatus },
    _getDefaultStatus: () => ({ ...defaultStatus }),
    _getStatusFilename: () => STATUS_FILENAME,
    _getWriteInterval: () => 10,
    // Export reset helper for tests (legacy)
    _resetStatusModule: () => {
        globalStatusUpdater = null;
    }
}; 