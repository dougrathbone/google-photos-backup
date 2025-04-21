const path = require('path');
const winston = require('winston');
const lockfile = require('proper-lockfile');
const statusUpdater = require('./statusUpdater');
const { loadConfig } = require('./configLoader');
const { authorize } = require('./googleAuth');
const { findLatestFileDateRecursive } = require('./fileUtils');
const { getLatestMediaItem } = require('./googlePhotosApi');
const { loadState, saveState } = require('./stateManager');
const { runInitialSync, runIncrementalSync } = require('./syncManager');

// --- Configuration Loading ---
const configPath = path.resolve(__dirname, '../config.json');
let config;

try {
    config = loadConfig(configPath);
} catch (error) {
    console.error("Failed to initialize configuration:", error.message);
    process.exit(1);
}

// --- Logger Setup ---
const logger = winston.createLogger({
    level: 'info', // Default level, could be made configurable
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.printf(info => `${info.timestamp} ${info.level.toUpperCase()}: ${info.message}`)
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
            )
        }),
        new winston.transports.File({ filename: config.logFilePath })
    ],
    exceptionHandlers: [
        // Log unhandled exceptions to the file
        new winston.transports.File({ filename: path.join(path.dirname(config.logFilePath), 'exceptions.log') })
    ],
    rejectionHandlers: [
        // Log unhandled promise rejections to the file
        new winston.transports.File({ filename: path.join(path.dirname(config.logFilePath), 'rejections.log') })
    ]
});

// Define lock file path (use config dir or data dir? Config seems better)
// NOTE: Ensure this matches the name used in installer.sh
const lockFilePath = path.join(path.dirname(configPath), 'google-photos-backup.lock'); 

const CONTINUOUS_MODE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

logger.info("Starting Google Photos Backup...");
logger.info(`Using configuration file: ${configPath}`);
// Log if debug modes are active
if (config.debugMaxPages && config.debugMaxPages > 0) {
    logger.warn(`*** Debug mode enabled: Max ${config.debugMaxPages} pages will be fetched for initial sync. ***`);
}
if (config.debugMaxDownloads && config.debugMaxDownloads > 0) {
    logger.warn(`*** Debug mode enabled: Max ${config.debugMaxDownloads} downloads will be attempted per run. ***`);
}

// --- Main Application Logic ---

async function main() {
    let releaseLock = async () => {};
    let isContinuous = false;
    let dataDir = path.dirname(config.logFilePath); // Infer data dir from log path
    let accessToken = null;
    let authClient = null;

    try {
        // --- Initialize Status File ---
        await statusUpdater.initializeStatus(dataDir, logger);

        // --- Acquire Lock ---
        logger.info(`Attempting to acquire lock: ${lockFilePath}`);
        try {
            // Options: stale: duration lock is considered stale, retries: attempts
            releaseLock = await lockfile.lock(lockFilePath, { stale: 3 * 60 * 1000, retries: 0 }); // 3 min stale, no retries
            logger.info('Lock acquired successfully.');
        } catch (error) {
            if (error.code === 'ELOCKED') {
                logger.warn(`Lock file ${lockFilePath} already held by another process. Checking status file...`);
                process.exit(0); // Exit gracefully
            } else {
                throw error; // Rethrow other lock errors
            }
        }

        // --- Original Main Logic ---
        logger.info("Application starting...");
        logger.info(`Local sync directory: ${config.localSyncDirectory}`);
        logger.info(`Sync interval: ${config.syncIntervalHours} hours`);

        // Check if continuous mode is set in config
        isContinuous = !!config.continuousMode;
        
        // --- Authentication ---
        let authResult = null;
        
        try {
            authResult = await authorize(config.credentialsPath, config.stateFilePath, logger);
            if (!authResult) {
                throw new Error('Authorization returned null. Cannot proceed.');
            }
            accessToken = authResult.accessToken;
            authClient = authResult.client;
            logger.info('Google Photos API access token acquired successfully.');
        } catch (error) {
            logger.error('Failed to authenticate or acquire access token:', error.message);
            logger.error('Please check your client_secret.json configuration and ensure you completed the authentication flow.');
            process.exit(1); // Exit if authentication fails
        }

        if (!accessToken) throw new Error('Authentication failed, cannot proceed.');

        // --- Initial Run / State Load ---
        let currentState = await loadState(config.stateFilePath, logger);
        await statusUpdater.updateStatus({ lastSyncTimestamp: currentState.lastSyncTimestamp }, logger);
        let lastSyncTime = currentState.lastSyncTimestamp;
        logger.info(`Current state loaded. Last sync timestamp: ${lastSyncTime || 'Never'}`);

        // --- Startup Status Logging ---
        logger.info('Gathering startup status information...');

        // 1. Check latest local file date
        const latestLocalDate = await findLatestFileDateRecursive(config.localSyncDirectory, logger);
        if (latestLocalDate) {
            logger.info(`Latest file date found in local directory (${config.localSyncDirectory}): ${latestLocalDate.toISOString()}`);
        } else {
            logger.info(`No files found or error scanning local directory (${config.localSyncDirectory}). Assuming full sync needed.`);
        }

        // 2. Check latest Google Photos date
        const latestMediaItem = await getLatestMediaItem(accessToken, logger);
        if (latestMediaItem && latestMediaItem.mediaMetadata && latestMediaItem.mediaMetadata.creationTime) {
            logger.info(`Latest media item creation time in Google Photos: ${latestMediaItem.mediaMetadata.creationTime}`);
            // Optional: Log filename if useful
            // logger.info(`Latest media item filename: ${latestMediaItem.filename}`);
        } else {
            logger.warn('Could not determine the latest media item date from Google Photos.');
        }

        // 3. Sync difference (Placeholder)
        // TODO: Implement state management and sync logic to calculate this accurately.
        logger.info('Sync difference calculation pending implementation of state management and sync logic.');

        // --- Synchronization Logic ---
        let initialRun = !lastSyncTime;
        let syncSuccess = false;
        let syncTimestamp = new Date(); 
        
        if (initialRun) {
            logger.info('Performing initial sync...');
            const initialSyncResult = await runInitialSync(accessToken, config, logger);
            syncSuccess = initialSyncResult.success;
        } else {
            logger.info(`Performing incremental sync (Last sync: ${lastSyncTime})...`);
            const incrementalSyncResult = await runIncrementalSync(lastSyncTime, accessToken, config, logger);
            syncSuccess = incrementalSyncResult.success;
        }

        // --- Save State After First Sync ---
        if (syncSuccess) {
            currentState = { ...currentState, lastSyncTimestamp: syncTimestamp.toISOString() };
            await saveState(config.stateFilePath, currentState, logger);
            await statusUpdater.updateStatus({ lastSyncTimestamp: currentState.lastSyncTimestamp }, logger);
            lastSyncTime = currentState.lastSyncTimestamp; // Update variable for continuous loop
        } else {
            logger.warn('Initial/Incremental sync run failed, not updating state file timestamp.');
            // Exit if the first sync fails, even in continuous mode?
            if (isContinuous) {
                logger.error('Exiting continuous mode due to initial sync failure.');
                throw new Error('Initial sync failed, cannot continue in continuous mode.');
            }
        }

        // --- Continuous Mode Loop ---
        if (isContinuous) {
            logger.info(`Entering continuous mode. Checking for updates every ${CONTINUOUS_MODE_INTERVAL_MS / 1000 / 60} minutes.`);
            // Loop indefinitely (or until service is stopped)
            while (true) {
                try {
                    // Wait for the interval
                    logger.info(`Continuous mode: Waiting for ${CONTINUOUS_MODE_INTERVAL_MS / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, CONTINUOUS_MODE_INTERVAL_MS));
                    
                    logger.info(`Continuous mode: Performing incremental sync (Last sync: ${lastSyncTime})...`);
                    syncTimestamp = new Date(); // Timestamp for this specific sync
                    const incrementalSyncResult = await runIncrementalSync(
                        lastSyncTime, 
                        accessToken, 
                        config, 
                        logger
                    );
                    
                    // Save state only if successful
                    if (incrementalSyncResult.success) {
                        currentState = { ...currentState, lastSyncTimestamp: syncTimestamp.toISOString() };
                        await saveState(config.stateFilePath, currentState, logger);
                        await statusUpdater.updateStatus({ lastSyncTimestamp: currentState.lastSyncTimestamp }, logger);
                        lastSyncTime = currentState.lastSyncTimestamp; // Update for next loop
                        logger.info('Continuous mode: Incremental sync successful, state updated.');
                    } else {
                         logger.warn('Continuous mode: Incremental sync failed, state not updated.');
                    }

                } catch (loopError) {
                    // Log errors within the loop but don't exit the process
                    logger.error('Continuous mode: Error during incremental sync loop:', loopError);
                    logger.warn('Continuous mode: Will retry after the next interval.');
                }
            }
        } else {
             logger.info('Application finished (non-continuous mode).');
             await statusUpdater.setIdleStatus(logger); // Set status to idle on exit
        }
        // --- End Original Main Logic ---

    } catch (error) {
        logger.error('Unhandled error in main execution scope:', error);
        await statusUpdater.updateStatus({ status: 'failed', lastRunSummary: `Main scope error: ${error.message}` }, logger);
        await releaseLock(); 
        process.exit(1); 
    } finally {
        if (!isContinuous) { 
            await releaseLock();
            logger.info('Lock released.');
        }
    }
}

// --- Graceful Shutdown Handling ---
let exiting = false;
async function gracefulShutdown(signal) {
    if (exiting) return; // Prevent duplicate shutdowns
    exiting = true;
    logger.warn(`Received ${signal}. Shutting down gracefully...`);
    
    // Try to release lock
    try {
        const releaseLock = await lockfile.lock(lockFilePath, { retries: 0 });
        await releaseLock();
        logger.info('Lock released during shutdown.');
    } catch (err) {
        // Ignore lock errors during shutdown (might be held by self or already gone)
        if (err.code !== 'ELOCKED') {
             logger.warn(`Error releasing lock during shutdown: ${err.message}`);
        }
    }
    
    // Try to set status to idle
    try {
         // Re-infer dataDir in case main didn't run far enough
         const dataDir = path.dirname(config?.logFilePath || './gphotos_sync.log');
         await statusUpdater.initializeStatus(dataDir, logger); // Ensure path is set
         await statusUpdater.setIdleStatus(logger); 
         logger.info('Status set to idle during shutdown.');
    } catch (err) {
        logger.error(`Error setting idle status during shutdown: ${err.message}`);
    }

    logger.info('Graceful shutdown complete.');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// --- Run Main --- 
main(); 