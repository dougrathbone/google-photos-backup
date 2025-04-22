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

const APP_NAME = 'google-photos-backup'; // Consistent naming

/**
 * Determines environment, resolves base paths, loads configuration,
 * and overrides/resolves paths within the config object.
 *
 * @param {string} nodeEnv - The value of process.env.NODE_ENV.
 * @param {string} scriptDirname - The value of __dirname from the calling script.
 * @returns {object} An object containing: { config, baseConfigDir, baseDataDir, baseLogDir, configPath, lockFilePath, isProduction }
 * @throws {Error} If configuration loading fails.
 */
function initializeConfigAndPaths(nodeEnv, scriptDirname) {
    const isProduction = nodeEnv === 'production';
    console.log(`Initializing config and paths (Mode: ${isProduction ? 'Production' : 'Development'})`);

    let baseConfigDir, baseDataDir, baseLogDir;

    if (isProduction) {
        baseConfigDir = '/etc/' + APP_NAME;
        baseDataDir = '/var/lib/' + APP_NAME;
        baseLogDir = '/var/log/' + APP_NAME;
    } else {
        const projectRoot = path.resolve(scriptDirname, '..');
        baseConfigDir = projectRoot;
        baseDataDir = path.join(projectRoot, 'data');
        baseLogDir = path.join(projectRoot, 'logs');
    }

    const configPath = isProduction
        ? path.join(baseConfigDir, 'config.json')
        : path.resolve(scriptDirname, '../config.json');

    let config;
    try {
        config = loadConfig(configPath);
        console.log(`Raw configuration loaded from: ${configPath}`);

        if (isProduction) {
            console.log("Overriding configuration paths for PRODUCTION environment.");
            config.credentialsPath = path.join(baseConfigDir, path.basename(config.credentialsPath || 'client_secret.json'));
            config.stateFilePath = path.join(baseDataDir, path.basename(config.stateFilePath || 'sync_state.json'));
            config.logFilePath = path.join(baseLogDir, path.basename(config.logFilePath || 'gphotos_sync.log'));
            config.statusFilePath = path.join(baseDataDir, path.basename(config.statusFilePath || 'status.json'));
            if (!config.localSyncDirectory) {
                 config.localSyncDirectory = path.join(baseDataDir, 'gphotos_backup');
                 console.log(`localSyncDirectory not set, defaulting to: ${config.localSyncDirectory}`);
            }
        } else {
            console.log("Resolving paths for DEVELOPMENT environment.");
            config.credentialsPath = path.resolve(baseConfigDir, config.credentialsPath);
            config.stateFilePath = path.resolve(baseDataDir, path.basename(config.stateFilePath || 'sync_state.json'));
            config.logFilePath = path.resolve(baseLogDir, path.basename(config.logFilePath || 'gphotos_sync.log'));
            config.statusFilePath = path.resolve(baseDataDir, path.basename(config.statusFilePath || 'status.json'));
            config.localSyncDirectory = path.resolve(baseConfigDir, config.localSyncDirectory);
            console.log("Resolved development paths:", JSON.stringify(config, null, 2));
        }
    } catch (error) {
        console.error(`Failed to load/process configuration from ${configPath}:`, error.message);
        // Re-throw the error to be handled by the caller
        throw new Error(`Configuration error from ${configPath}: ${error.message}`);
    }

    // Define lock file path based on environment
    const lockFileName = 'google-photos-backup.lock';
    const lockFilePath = isProduction
        ? path.join(baseDataDir, lockFileName)
        : path.join(path.dirname(config.stateFilePath), lockFileName); // Near state file for dev

    return { config, baseConfigDir, baseDataDir, baseLogDir, configPath, lockFilePath, isProduction };
}

// --- Global Variables (initialized after config loading) ---
let config;
let lockFilePath;
let isProduction;
let logger;

// --- Initial Setup Execution ---
try {
    const initResult = initializeConfigAndPaths(process.env.NODE_ENV, __dirname);
    config = initResult.config;
    lockFilePath = initResult.lockFilePath;
    isProduction = initResult.isProduction;
    const configPath = initResult.configPath;

    // --- Logger Setup (Now depends on initialized config) ---
    try {
        require('fs').mkdirSync(path.dirname(config.logFilePath), { recursive: true });
    } catch (mkdirError) {
        console.error(`Failed to create log directory ${path.dirname(config.logFilePath)}:`, mkdirError);
    }

    logger = winston.createLogger({
        level: config.logLevel || 'info',
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
            new winston.transports.File({ filename: path.join(path.dirname(config.logFilePath), 'error.log'), level: 'error' })
        ],
        exceptionHandlers: [
            new winston.transports.File({ filename: path.join(path.dirname(config.logFilePath), 'exceptions.log') })
        ],
        rejectionHandlers: [
            new winston.transports.File({ filename: path.join(path.dirname(config.logFilePath), 'rejections.log') })
        ]
    });

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

} catch (initializationError) {
    console.error("Failed during critical initialization:", initializationError);
    process.exit(1);
}

// --- Main Application Logic (Uses globally initialized config, logger, lockFilePath) ---

async function main() {
    // --- Initialization Check ---
    // Ensure essential global variables were initialized before proceeding.
    if (!config || !logger || !lockFilePath) {
        // Use console.error as logger might not be initialized
        console.error("CRITICAL: Configuration or logger not initialized. Main function cannot run. This likely indicates an error during initial setup.");
        // Avoid calling process.exit here directly, let the top-level handler do it if needed.
        return; // Stop execution of main
    }

    let releaseLock = async () => { logger.debug('No lock acquired, release is no-op.'); };
    const statusFilePath = config.statusFilePath;
    const effectiveDataDir = path.dirname(statusFilePath);

    try {
        // Ensure Data Directory Exists
        try {
             require('fs').mkdirSync(effectiveDataDir, { recursive: true });
             logger.info(`Ensured data directory exists: ${effectiveDataDir}`);
        } catch (mkdirError) {
             logger.error(`CRITICAL: Failed to create data directory ${effectiveDataDir}:`, mkdirError);
             // Maybe try to release lock if acquired before exiting?
             process.exit(1);
        }

        // Initialize Status File
        await statusUpdater.initializeStatus(statusFilePath, logger);

        // Acquire Lock (Uses global lockFilePath)
        logger.info(`Attempting to acquire lock: ${lockFilePath}`);
        try {
            const lockOptions = {
                stale: 10 * 60 * 1000,
                retries: 0,
                lockfilePath: lockFilePath
             };
            releaseLock = await lockfile.lock(effectiveDataDir, lockOptions);
            logger.info(`Lock acquired successfully on directory: ${effectiveDataDir} (using ${lockFilePath} as identifier)`);
        } catch (error) {
            if (error.code === 'ELOCKED') {
                logger.warn(`Lock file ${lockFilePath} (on dir ${effectiveDataDir}) already held by another process. Checking status...`);
                process.exit(0); // Exit gracefully
            } else {
                logger.error(`Failed to acquire lock on ${effectiveDataDir} (using ${lockFilePath}):`, error);
                throw error; // Rethrow other lock errors
            }
        }

        // Get Configuration Settings (Uses global config)
        const isContinuous = !!config.continuousMode;
        const localSyncDir = config.localSyncDirectory;

        // Authentication (Uses global config)
        logger.info("Attempting Google Authentication...");
        let authResult = null;
        try {
            authResult = await authorize(config.credentialsPath, config.stateFilePath, logger);
            if (!authResult || !authResult.accessToken || !authResult.client) {
                throw new Error('Authorization failed or did not return valid credentials/client.');
            }
            const accessToken = authResult.accessToken;
            const authClient = authResult.client;
            logger.info('Google Photos API access token acquired successfully.');

            // === Main Sync Logic (Now within Authentication Success block) ===

            // --- Initial Run / State Load ---
            logger.info(`Loading state from: ${config.stateFilePath}`);
            let currentState = await loadState(config.stateFilePath, logger);
            await statusUpdater.updateStatus({ status: 'loading_state', lastSyncTimestamp: currentState.lastSyncTimestamp }, logger);
            let lastSyncTime = currentState.lastSyncTimestamp;
            logger.info(`Current state loaded. Last sync timestamp: ${lastSyncTime || 'Never'}`);

            // --- Startup Status Logging ---
            logger.info('Gathering startup status information...');
            await statusUpdater.updateStatus({ status: 'checking_local_files' }, logger);
            const latestLocalDate = await findLatestFileDateRecursive(localSyncDir, logger);
            if (latestLocalDate) {
                logger.info(`Latest file date found locally (${localSyncDir}): ${latestLocalDate.toISOString()}`);
                await statusUpdater.updateStatus({ lastLocalFileDate: latestLocalDate.toISOString() }, logger);
            } else {
                logger.info(`No files found or error scanning local directory (${localSyncDir}).`);
                 await statusUpdater.updateStatus({ lastLocalFileDate: null }, logger);
            }

            logger.info('Checking latest item in Google Photos...');
            await statusUpdater.updateStatus({ status: 'checking_google_photos' }, logger);
            const latestMediaItem = await getLatestMediaItem(accessToken, logger);
            if (latestMediaItem && latestMediaItem.mediaMetadata && latestMediaItem.mediaMetadata.creationTime) {
                logger.info(`Latest media item creation time in Google Photos: ${latestMediaItem.mediaMetadata.creationTime}`);
                 await statusUpdater.updateStatus({ lastGooglePhotoDate: latestMediaItem.mediaMetadata.creationTime }, logger);
            } else {
                logger.warn('Could not determine the latest media item date from Google Photos.');
                 await statusUpdater.updateStatus({ lastGooglePhotoDate: null }, logger);
            }

            // --- Synchronization Logic ---
            let initialRun = !lastSyncTime;
            let syncSuccess = false;
            let syncItemsDownloaded = 0;
            let syncError = null;
            const syncTimestamp = new Date();

            try {
                if (initialRun) {
                    logger.info('Performing initial sync...');
                    await statusUpdater.updateStatus({ status: 'initial_sync_running', currentRunStart: syncTimestamp.toISOString() }, logger);
                    const initialSyncResult = await runInitialSync(accessToken, config, logger);
                    syncSuccess = initialSyncResult.success;
                    syncItemsDownloaded = initialSyncResult.itemsDownloaded || 0;
                } else {
                    logger.info(`Performing incremental sync (Last sync: ${lastSyncTime})...`);
                    await statusUpdater.updateStatus({ status: 'incremental_sync_running', currentRunStart: syncTimestamp.toISOString() }, logger);
                    const incrementalSyncResult = await runIncrementalSync(lastSyncTime, accessToken, config, logger);
                    syncSuccess = incrementalSyncResult.success;
                    syncItemsDownloaded = incrementalSyncResult.itemsDownloaded || 0;
                }
            } catch (syncErr) {
                logger.error('Error during synchronization process:', syncErr);
                syncSuccess = false;
                syncError = syncErr.message;
                await statusUpdater.updateStatus({ status: 'sync_failed', error: syncError }, logger);
            }

            // --- Save State After Sync ---
            if (syncSuccess) {
                logger.info(`Sync finished successfully. Items downloaded: ${syncItemsDownloaded}. Updating state...`);
                const newTimestamp = syncTimestamp.toISOString();
                currentState = { ...currentState, lastSyncTimestamp: newTimestamp };
                await saveState(config.stateFilePath, currentState, logger);
                await statusUpdater.updateStatus({
                    status: isContinuous ? 'idle_continuous' : 'sync_completed',
                    lastSyncTimestamp: newTimestamp,
                    lastRunOutcome: 'success',
                    lastRunItemsDownloaded: syncItemsDownloaded,
                    lastRunError: null,
                    lastRunFinish: new Date().toISOString()
                }, logger);
                lastSyncTime = newTimestamp;
            } else {
                logger.warn('Sync run failed or encountered errors, not updating state file timestamp.');
                 await statusUpdater.updateStatus({
                     status: 'sync_failed',
                     lastRunOutcome: 'failure',
                     lastRunItemsDownloaded: syncItemsDownloaded,
                     lastRunError: syncError || 'Unknown sync error',
                     lastRunFinish: new Date().toISOString()
                 }, logger);

                if (initialRun && !isContinuous) {
                     logger.error('Initial sync failed in non-continuous mode. Exiting.');
                     throw new Error('Initial sync failed.');
                } else if (initialRun && isContinuous) {
                     logger.error('Initial sync failed in continuous mode. Exiting to prevent loop.');
                     throw new Error('Initial sync failed, cannot continue in continuous mode.');
                }
            }

             // === End of Main Sync Logic block ===

        } catch (error) {
            logger.error('Failed during Authentication or main sync execution:', error);
            await statusUpdater.updateStatus({
                status: 'failed',
                lastRunOutcome: 'failure',
                lastRunError: `Authentication/Setup Error: ${error.message}`,
                lastRunFinish: new Date().toISOString()
             }, logger);
            process.exit(1);
        }

        // Continuous Mode Loop (Uses global config)
        if (isContinuous) {
            logger.info(`Entering continuous mode. Checking for updates every ${CONTINUOUS_MODE_INTERVAL_MS / 1000 / 60} minutes.`);
            await statusUpdater.updateStatus({ status: 'idle_continuous' }, logger);
            while (true) {
                try {
                    logger.info(`Continuous mode: Waiting for ${CONTINUOUS_MODE_INTERVAL_MS / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, CONTINUOUS_MODE_INTERVAL_MS));

                    logger.info("Re-checking Authentication before continuous sync...");
                    authResult = await authorize(config.credentialsPath, config.stateFilePath, logger);
                     if (!authResult || !authResult.accessToken || !authResult.client) {
                         throw new Error('Continuous mode: Re-authorization failed.');
                     }
                     const accessToken = authResult.accessToken;
                     logger.info('Continuous mode: Authentication refreshed/verified.');

                    logger.info(`Continuous mode: Performing incremental sync (Last sync: ${lastSyncTime})...`);
                    const loopSyncTimestamp = new Date();
                    await statusUpdater.updateStatus({ status: 'incremental_sync_running', currentRunStart: loopSyncTimestamp.toISOString() }, logger);
                    let loopSyncSuccess = false;
                    let loopSyncItemsDownloaded = 0;
                    let loopSyncError = null;

                    try {
                        const incrementalSyncResult = await runIncrementalSync(
                            lastSyncTime,
                            accessToken,
                            config,
                            logger
                        );
                        loopSyncSuccess = incrementalSyncResult.success;
                        loopSyncItemsDownloaded = incrementalSyncResult.itemsDownloaded || 0;
                    } catch (loopErr) {
                         logger.error('Continuous mode: Error during incremental sync:', loopErr);
                         loopSyncSuccess = false;
                         loopSyncError = loopErr.message;
                         await statusUpdater.updateStatus({ status: 'sync_failed', error: loopSyncError }, logger);
                    }

                    if (loopSyncSuccess) {
                        const newTimestamp = loopSyncTimestamp.toISOString();
                        currentState = { ...currentState, lastSyncTimestamp: newTimestamp };
                        await saveState(config.stateFilePath, currentState, logger);
                        await statusUpdater.updateStatus({
                            status: 'idle_continuous',
                            lastSyncTimestamp: newTimestamp,
                            lastRunOutcome: 'success',
                            lastRunItemsDownloaded: loopSyncItemsDownloaded,
                            lastRunError: null,
                            lastRunFinish: new Date().toISOString()
                        }, logger);
                        lastSyncTime = newTimestamp;
                        logger.info(`Continuous mode: Incremental sync successful (${loopSyncItemsDownloaded} items). State updated.`);
                    } else {
                         logger.warn('Continuous mode: Incremental sync failed, state not updated.');
                          await statusUpdater.updateStatus({
                             status: 'idle_continuous',
                             lastRunOutcome: 'failure',
                             lastRunItemsDownloaded: loopSyncItemsDownloaded,
                             lastRunError: loopSyncError || 'Unknown sync error',
                             lastRunFinish: new Date().toISOString()
                         }, logger);
                    }

                } catch (loopError) {
                    logger.error('Continuous mode: Unhandled error in sync loop:', loopError);
                     await statusUpdater.updateStatus({
                        status: 'failed_continuous_loop',
                        error: `Loop Error: ${loopError.message}`
                     }, logger);
                    logger.warn('Continuous mode: Will retry after the next interval.');
                }
            }
        } else {
             logger.info('Application finished normally (non-continuous mode).');
             await statusUpdater.updateStatus({ status: 'idle_finished' }, logger);
        }

    } catch (error) {
        logger.error('Unhandled error in main execution scope:', error);
        try {
            await statusUpdater.updateStatus({ status: 'failed', lastRunOutcome: 'failure', lastRunError: `Main scope error: ${error.message}` }, logger);
        } catch (statusErr) {
            logger.error('Additionally failed to update status during main error handling:', statusErr);
        }
        if (releaseLock) {
            try { await releaseLock(); } catch (e) { logger.warn('Failed to release lock during error exit:', e.message); }
        }
        process.exit(1);
    } finally {
        if (!config.continuousMode && releaseLock) {
             try {
                await releaseLock();
                logger.info('Lock released on normal exit.');
             } catch (e) {
                 logger.warn('Failed to release lock during finally block:', e.message);
             }
        } else if (config.continuousMode) {
            logger.info('Running in continuous mode, lock remains held.');
        }
    }
}

// --- Graceful Shutdown Handling (Uses global config, logger, lockFilePath) ---
let exiting = false;
async function gracefulShutdown(signal) {
    if (exiting) return;
    exiting = true;
    logger.warn(`Received ${signal}. Shutting down gracefully...`);

    const statusFilePath = config?.statusFilePath;
    const lockFilePathRef = lockFilePath;
    const dataDirForShutdown = path.dirname(statusFilePath || './status.json');

    if (statusFilePath) {
        try {
             await statusUpdater.updateStatus({ status: 'shutting_down', signal: signal }, logger);
             logger.info('Status updated to shutting_down.');
        } catch (err) {
            logger.error(`Error setting shutting_down status: ${err.message}`);
        }
    } else {
         logger.warn('Status file path not configured, cannot update status on shutdown.');
    }

    logger.info(`Attempting to release lock on ${dataDirForShutdown} (using ${lockFilePathRef}) during shutdown...`);
    try {
        const isLocked = await lockfile.check(dataDirForShutdown, { lockfilePath: lockFilePathRef });
        if (isLocked) {
            await lockfile.unlock(dataDirForShutdown, { lockfilePath: lockFilePathRef });
            logger.info('Lock released successfully during shutdown.');
        } else {
            logger.info('Lock was not held, no need to release.');
        }
    } catch (err) {
        logger.warn(`Could not release lock during shutdown (may be normal): ${err.message} (Code: ${err.code})`);
    }

    if (statusFilePath) {
        try {
             await statusUpdater.setIdleStatus(logger);
             logger.info('Status set to idle during shutdown.');
        } catch (err) {
            logger.error(`Error setting idle status during shutdown: ${err.message}`);
        }
    }

    logger.info('Graceful shutdown sequence complete.');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (error, origin) => {
    logger.fatal('FATAL: Uncaught Exception:', { error: error.message, stack: error.stack, origin: origin });
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
     logger.fatal('FATAL: Unhandled Promise Rejection:', { reason: reason, promise: promise });
     process.exit(1);
});

// --- Run Main ---
if (logger) {
    main().catch(e => {
        // Catch any unexpected errors from main itself
        logger.fatal('Unhandled promise rejection in main function execution:', e);
        process.exit(1);
    });
} else {
    console.error("Skipping main() execution due to initialization failure.");
    // The top-level catch block should have already called process.exit
}

// Export the new function for testing purposes
module.exports = { initializeConfigAndPaths, main }; 