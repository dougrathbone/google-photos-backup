const path = require('path');
const winston = require('winston');
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

logger.info("Starting google-synchroniser...");
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
    logger.info("Application starting...");
    logger.info(`Local sync directory: ${config.localSyncDirectory}`);
    logger.info(`Sync interval: ${config.syncIntervalHours} hours`);

    // Log if debug mode is active
    if (config.debugMaxPages && config.debugMaxPages > 0) {
        logger.warn(`*** Debug mode enabled: Max ${config.debugMaxPages} pages will be fetched for initial sync. ***`);
    }

    // --- Authentication ---
    let authResult = null;
    let accessToken = null; 
    let authClient = null; 
    
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

    // --- Load State ---
    let currentState = await loadState(config.stateFilePath, logger);
    const lastSyncTime = currentState.lastSyncTimestamp;
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
    let syncSuccess = false;
    let syncTimestamp = new Date(); 
    
    if (!lastSyncTime) {
        // Run Initial Sync (pass full config)
        logger.info('Initial sync required (no previous sync timestamp found).');
        try {
            const initialSyncResult = await runInitialSync(accessToken, config, logger);
            syncSuccess = initialSyncResult.success; 
        } catch (error) {
            logger.error(`Initial sync failed with unhandled error: ${error.message}`);
            syncSuccess = false;
        }
    } else {
        // Run Incremental Sync
        logger.info(`Incremental sync needed (Last sync: ${lastSyncTime}).`);
        try {
            // Pass the full config object
            const incrementalSyncResult = await runIncrementalSync(
                lastSyncTime, 
                accessToken, 
                config, // Pass full config 
                logger
            );
            syncSuccess = incrementalSyncResult.success;
        } catch (error) {
            logger.error(`Incremental sync failed with unhandled error: ${error.message}`);
            syncSuccess = false;
        }
    }

    // --- Save State ---
    if (syncSuccess) {
        // Save the timestamp of the *start* of the successful sync run
        const newState = { ...currentState, lastSyncTimestamp: syncTimestamp.toISOString() };
        try {
            await saveState(config.stateFilePath, newState, logger);
        } catch (error) {
            logger.error(`Failed to save final state: ${error.message}`);
        }
    } else {
         logger.warn('Sync run failed or was not needed, not updating state file timestamp.');
    }

    logger.info('Application finished.');
}

main().catch(error => {
    logger.error("Unhandled error in main function:", error);
    process.exit(1);
});

// TODO: Implement graceful shutdown 