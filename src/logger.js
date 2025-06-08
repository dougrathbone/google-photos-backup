const winston = require('winston');
const path = require('path');

/**
 * Creates and configures a Winston logger instance.
 *
 * @param {object} config - Configuration object containing log settings
 * @param {string} config.logFilePath - Path to the main log file
 * @param {string} [config.logLevel='info'] - Log level (error, warn, info, debug)
 * @param {boolean} [isProduction=false] - Whether running in production mode
 * @returns {winston.Logger} Configured logger instance
 */
function createLogger(config, isProduction = false) {
    // Ensure log directory exists
    try {
        require('fs').mkdirSync(path.dirname(config.logFilePath), { recursive: true });
    } catch (mkdirError) {
        console.error(`Failed to create log directory ${path.dirname(config.logFilePath)}:`, mkdirError);
    }

    const logLevel = config.logLevel || 'info';
    const logDir = path.dirname(config.logFilePath);

    const logger = winston.createLogger({
        level: logLevel,
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        transports: [
            new winston.transports.Console({
                level: 'info',
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
                )
            }),
            new winston.transports.File({ filename: config.logFilePath, level: 'info' }),
            new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' })
        ],
        exceptionHandlers: [
            new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') })
        ],
        rejectionHandlers: [
            new winston.transports.File({ filename: path.join(logDir, 'rejections.log') })
        ]
    });

    return logger;
}

/**
 * Logs initial startup information.
 *
 * @param {winston.Logger} logger - Logger instance
 * @param {object} config - Configuration object
 * @param {string} configPath - Path to config file
 * @param {string} lockFilePath - Path to lock file
 * @param {boolean} isProduction - Whether running in production mode
 */
function logStartupInfo(logger, config, configPath, lockFilePath, isProduction) {
    logger.info("---------------------------------------------");
    logger.info(`Starting Google Photos Backup... (Mode: ${isProduction ? 'Production' : 'Development'})`);
    logger.info(`Using configuration file: ${configPath}`);
    logger.info(`Log file: ${config.logFilePath}`);
    logger.info(`State file: ${config.stateFilePath}`);
    logger.info(`Status file: ${config.statusFilePath}`);
    logger.info(`Lock file: ${lockFilePath}`);
    logger.info(`Credentials file: ${config.credentialsPath}`);
    logger.info(`Local sync target: ${config.localSyncDirectory}`);

    if (config.debugMaxPages && config.debugMaxPages > 0) {
        logger.warn(`*** Debug mode enabled: Max ${config.debugMaxPages} pages will be fetched. ***`);
    }
    if (config.debugMaxDownloads && config.debugMaxDownloads > 0) {
        logger.warn(`*** Debug mode enabled: Max ${config.debugMaxDownloads} downloads will be attempted. ***`);
    }
}

module.exports = {
    createLogger,
    logStartupInfo
}; 