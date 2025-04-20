const path = require('path');
const winston = require('winston');
const { loadConfig } = require('./configLoader');
const { authorize } = require('./googleAuth');

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

    // TODO: Implement initial sync logic using authClient
    // TODO: Implement incremental sync logic using authClient
    // TODO: Implement background process/scheduling

    logger.info("Placeholder for core logic. Application will now exit.");
}

main().catch(error => {
    logger.error("Unhandled error in main function:", error);
    process.exit(1);
});

// TODO: Implement graceful shutdown 