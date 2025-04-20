const path = require('path');
const winston = require('winston');
const { loadConfig } = require('./configLoader');
const { authorize } = require('./googleAuth');
const { findLatestFileDateRecursive } = require('./fileUtils');
const { getLatestMediaItem } = require('./googlePhotosApi');
const { loadState, saveState } = require('./stateManager');
const { runInitialSync } = require('./syncManager');

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
// logger.debug("Loaded configuration:", config); // Use debug level for verbose output

// --- Main Application Logic ---

async function main() {
    logger.info("Application starting...");
    logger.info(`Local sync directory: ${config.localSyncDirectory}`);
    logger.info(`Sync interval: ${config.syncIntervalHours} hours`);

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
    logger.info(`Current state loaded. Last sync timestamp: ${currentState.lastSyncTimestamp || 'Never'}`);

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
    const syncNeeded = !currentState.lastSyncTimestamp; // Basic check for initial sync

    if (syncNeeded) {
        logger.info('Initial sync required (no previous sync timestamp found).');
        try {
            const initialSyncResult = await runInitialSync(accessToken, config.localSyncDirectory, logger);
            syncSuccess = initialSyncResult.success; 
        } catch (error) {
            logger.error(`Initial sync failed with unhandled error: ${error.message}`);
            syncSuccess = false;
        }
    } else {
        logger.info(`Incremental sync needed (Last sync: ${currentState.lastSyncTimestamp}). Logic not yet implemented.`);
        // TODO: Implement incremental sync logic using accessToken and currentState
        syncSuccess = true; // Placeholder: Assume success if no sync needed yet
    }

    // --- Save State ---
    if (syncNeeded && syncSuccess) {
        const newState = { ...currentState, lastSyncTimestamp: new Date().toISOString() };
        try {
            await saveState(config.stateFilePath, newState, logger);
        } catch (error) {
            logger.error(`Failed to save final state: ${error.message}`);
        }
    } else if (!syncNeeded) {
         logger.info('No sync run needed or logic not implemented, skipping state save.');
    } else {
         logger.warn('Sync run failed, not updating state file.');
    }

    logger.info('Application finished.');
}

main().catch(error => {
    logger.error("Unhandled error in main function:", error);
    process.exit(1);
});

// TODO: Implement graceful shutdown 