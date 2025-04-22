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

let statusFilePath = null; // Will be set by initializeStatus
let currentStatus = { ...defaultStatus };

/**
 * Initializes the status updater with the path to the status file.
 * Tries to load existing status.
 * @param {string} fullStatusPath - The full, resolved path to the status file.
 * @param {winston.Logger} logger - Logger instance.
 */
async function initializeStatus(fullStatusPath, logger) {
    if (!fullStatusPath || typeof fullStatusPath !== 'string') {
        logger.error('Invalid status file path provided to initializeStatus.');
        // Handle error appropriately - maybe throw?
        currentStatus = { ...defaultStatus }; // Use defaults
        statusFilePath = null;
        return;
    }
    statusFilePath = fullStatusPath;
    logger.debug(`Status file path set to: ${statusFilePath}`);
    try {
        const fileContent = await fs.readFile(statusFilePath, 'utf8');
        currentStatus = JSON.parse(fileContent);
        // Reset potentially stale running status on init
        if (currentStatus.status?.startsWith('running')) {
            logger.warn(`Found stale 'running' status in ${statusFilePath} on startup. Resetting to 'idle'.`);
            currentStatus.status = 'idle';
            currentStatus.pid = null;
            await writeStatusToFile(logger); // Write cleaned status back
        }
        logger.info('Loaded existing status file.');
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.info('Status file not found, initializing with default status.');
            currentStatus = { ...defaultStatus };
            await writeStatusToFile(logger); // Create the initial file
        } else {
            logger.error(`Error loading status file ${statusFilePath}, using defaults: ${err.message}`);
            currentStatus = { ...defaultStatus };
            // Don't write back if loading failed for other reasons
        }
    }
}

/**
 * Writes the current status object to the file.
 * INTERNAL USE ONLY
 * @param {winston.Logger} logger - Logger instance.
 */
async function writeStatusToFile(logger) {
    if (!statusFilePath) {
        logger.error('Status file path not initialized. Cannot write status.');
        return;
    }
    try {
        const statusString = JSON.stringify(currentStatus, null, 2);
        await fs.writeFile(statusFilePath, statusString, 'utf8');
        logger.debug(`Status file updated: ${statusFilePath}`);
    } catch (err) {
        logger.error(`Failed to write status file ${statusFilePath}: ${err.message}`);
    }
}

/**
 * Updates specific fields in the status and writes to the file.
 * @param {object} updates - An object containing fields to update.
 * @param {winston.Logger} logger - Logger instance.
 */
async function updateStatus(updates, logger) {
    // Ensure statusFilePath is initialized before trying to update
    if (!statusFilePath) {
        logger.error('Status file path not initialized. Call initializeStatus first.');
        // Optionally throw an error or initialize here?
        // For now, just log and potentially update in-memory status
    }
    currentStatus = { ...currentStatus, ...updates };
    await writeStatusToFile(logger);
}

/**
 * Sets the status to indicate the start of a sync run.
 * @param {'initial' | 'incremental'} runType - The type of sync run.
 * @param {number} totalItems - The total number of items to process in this run.
 * @param {string | null} lastSync - The timestamp of the previous sync.
 * @param {winston.Logger} logger - Logger instance.
 */
async function setSyncStartStatus(runType, totalItems, lastSync, logger) {
    await updateStatus({
        status: `running:${runType}`,
        pid: process.pid,
        currentRunStartTimeISO: new Date().toISOString(),
        currentRunTotalItems: totalItems,
        currentRunItemsDownloaded: 0,
        lastSyncTimestamp: lastSync // Update last sync time at start
    }, logger);
}

/**
 * Increments the count of downloaded items in the status.
 * Writes update periodically to avoid excessive writes.
 * @param {winston.Logger} logger - Logger instance.
 */
let pendingWrites = 0;
const WRITE_INTERVAL = 10; // Write status every 10 download increments
async function incrementDownloadedCount(logger) {
    currentStatus.currentRunItemsDownloaded++;
    pendingWrites++;
    if (pendingWrites >= WRITE_INTERVAL || currentStatus.currentRunItemsDownloaded === currentStatus.currentRunTotalItems) {
        await writeStatusToFile(logger);
        pendingWrites = 0;
    }
}

/**
 * Sets the status to indicate the end of a sync run (success or failure).
 * @param {boolean} success - Whether the run was successful.
 * @param {string} summary - A summary message of the run.
 * @param {winston.Logger} logger - Logger instance.
 */
async function setSyncEndStatus(success, summary, logger) {
    await updateStatus({
        status: success ? 'idle' : 'failed',
        pid: null,
        // currentRunStartTimeISO: null, // Keep start time for reference?
        // currentRunTotalItems: 0, // Keep totals for reference?
        // currentRunItemsDownloaded: 0, // Keep counts for reference?
        lastRunSummary: summary
    }, logger);
}

/**
 * Sets the status explicitly to idle (e.g., on clean exit).
 * @param {winston.Logger} logger - Logger instance.
 */
async function setIdleStatus(logger) {
     // Only update if not already idle to avoid unnecessary writes
    if (currentStatus.status !== 'idle') {
        await updateStatus({
            status: 'idle',
            pid: null
        }, logger);
    }
}


module.exports = { 
    initializeStatus, 
    updateStatus, 
    setSyncStartStatus,
    incrementDownloadedCount,
    setSyncEndStatus,
    setIdleStatus,
    // Export internal state ONLY for testing:
    _getStatusFilePath: () => statusFilePath,
    _getCurrentStatus: () => currentStatus,
    _getDefaultStatus: () => defaultStatus,
    _getStatusFilename: () => STATUS_FILENAME,
    _getWriteInterval: () => WRITE_INTERVAL,
    // Export reset helper for tests
    _resetStatusModule: () => {
        statusFilePath = null;
        currentStatus = { ...defaultStatus };
        pendingWrites = 0;
    }
}; 