const path = require('path');
const winston = require('winston');
const { loadConfig } = require('./configLoader');
const { authorize } = require('./googleAuth');
const { findLatestFileDateRecursive } = require('./fileUtils');
const { getLatestMediaItem } = require('./googlePhotosApi');
const { loadState, saveState } = require('./stateManager');

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
    let authClient;
    try {
        // Pass the client secrets path from config
        // Pass the explicit path './credentials.js' for the OAuth token
        // Pass the logger instance
        const oauthTokenPath = path.resolve(__dirname, '../credentials.js'); // Resolve path relative to project root
        authClient = await authorize(config.credentialsPath, oauthTokenPath, logger);
        logger.info('Google Photos API client authorized successfully.');
    } catch (error) {
        logger.error('Failed to authenticate with Google Photos API:', error.message);
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
    const latestMediaItem = await getLatestMediaItem(authClient, logger);
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

    // --- End Startup Status Logging ---

    // TODO: Implement initial sync logic using authClient and currentState
    // TODO: Implement incremental sync logic using authClient and currentState
    // TODO: Implement background process/scheduling

    logger.info("Placeholder for core logic. Application will now exit.");

    // --- Save State (Placeholder) ---
    // In a real run, update the timestamp after a successful sync cycle
    const newState = { ...currentState, lastSyncTimestamp: new Date().toISOString() };
    try {
        await saveState(config.stateFilePath, newState, logger);
    } catch (error) {
        logger.error(`Failed to save final state: ${error.message}`);
        // Decide if this should prevent exit? For now, just log it.
    }
}

main().catch(error => {
    logger.error("Unhandled error in main function:", error);
    process.exit(1);
});

// TODO: Implement graceful shutdown 