const path = require('path');
const lockfile = require('proper-lockfile');
const { authorize } = require('./googleAuth');
const { findLatestFileDateRecursive } = require('./fileUtils');
const { getLatestMediaItem } = require('./googlePhotosApi');
const { loadState, saveState } = require('./stateManager');
const { runInitialSync, runIncrementalSync } = require('./syncManager');
const { initializeConfigAndPaths } = require('./environment');
const { createLogger, logStartupInfo } = require('./logger');
const { ErrorHandler, ErrorTypes, ErrorSeverity } = require('./errorHandler');
const { SyncContext } = require('./syncContext');

// --- Constants ---
const CONTINUOUS_MODE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// --- Application Context (replaces global variables) ---
let syncContext = null;

// --- Initial Setup Execution ---
try {
    const initResult = initializeConfigAndPaths(process.env.NODE_ENV, __dirname);
    const config = initResult.config;
    const lockFilePath = initResult.lockFilePath;
    const isProduction = initResult.isProduction;
    const configPath = initResult.configPath;

    // --- Logger Setup (Using logger module) ---
    const logger = createLogger(config, isProduction);
    logStartupInfo(logger, config, configPath, lockFilePath, isProduction);

    // --- Create Sync Context (replaces global variables) ---
    // Pass status file path so SyncContext can create and initialize StatusUpdater
    // ErrorHandler will be set after StatusUpdater is initialized in main()
    syncContext = new SyncContext(config, logger, null, config.statusFilePath);
    syncContext.setLockInfo(lockFilePath, null); // Lock function will be set later

} catch (initializationError) {
    console.error("Failed during critical initialization:", initializationError);
    process.exit(1); // Keep this exit as we don't have errorHandler yet
}

// --- Main Application Logic (Uses sync context) ---

async function main(context) {
    // --- Initialization Check ---
    if (!context) {
        console.error("CRITICAL: SyncContext not provided. Main function cannot run.");
        return; // Stop execution of main
    }

    // Initialize the context (including StatusUpdater if created)
    try {
        await context.initialize();
    } catch (initError) {
        console.error("CRITICAL: Failed to initialize SyncContext:", initError.message);
        return; // Stop execution of main
    }

    // Setup ErrorHandler now that StatusUpdater is initialized
    if (!context.errorHandler && context.statusUpdater) {
        const { ErrorHandler } = require('./errorHandler');
        context.errorHandler = new ErrorHandler(context.logger, context.statusUpdater);
    }

    // Validate context has all required dependencies
    try {
        context.validateDependencies();
    } catch (validationError) {
        console.error("CRITICAL: SyncContext validation failed:", validationError.message);
        return; // Stop execution of main
    }

    const { config, logger, errorHandler } = context;

    let releaseLock = async () => { logger.debug('No lock acquired, release is no-op.'); };
    const statusFilePath = config.statusFilePath;
    const effectiveDataDir = path.dirname(statusFilePath);

    try {
        // Ensure Data Directory Exists
        try {
             require('fs').mkdirSync(effectiveDataDir, { recursive: true });
             logger.info(`Ensured data directory exists: ${effectiveDataDir}`);
        } catch (mkdirError) {
             const error = errorHandler.createFileSystemError(`Failed to create data directory ${effectiveDataDir}`, mkdirError);
             await errorHandler.handleError(error, 'Directory Creation', true);
             return; // Exit main function
        }

        // Status updater is already initialized in context.initialize()

        // Acquire Lock
        logger.info(`Attempting to acquire lock: ${context.lockFilePath}`);
        try {
            const lockOptions = {
                stale: 10 * 60 * 1000,
                retries: 0,
                lockfilePath: context.lockFilePath
             };
            releaseLock = await lockfile.lock(effectiveDataDir, lockOptions);
            context.setLockInfo(context.lockFilePath, releaseLock);
            logger.info(`Lock acquired successfully on directory: ${effectiveDataDir} (using ${context.lockFilePath} as identifier)`);
        } catch (error) {
            if (error.code === 'ELOCKED') {
                const lockError = errorHandler.createLockError(`Lock file ${context.lockFilePath} already held by another process`);
                await errorHandler.handleError(lockError, 'Lock Acquisition');
                return; // Exit gracefully
            } else {
                const lockError = errorHandler.createLockError(`Failed to acquire lock on ${effectiveDataDir}`, error);
                await errorHandler.handleError(lockError, 'Lock Acquisition', true);
                return; // Exit main function
            }
        }

        // Get Configuration Settings
        const isContinuous = !!config.continuousMode;
        const localSyncDir = config.localSyncDirectory;

        // Authentication
        logger.info("Attempting Google Authentication...");
        try {
            const authResult = await authorize(config.credentialsPath, config.stateFilePath, logger);
            if (!authResult || !authResult.accessToken || !authResult.client) {
                throw new Error('Authorization failed or did not return valid credentials/client.');
            }
            context.setAuthResult(authResult);
            logger.info('Google Photos API access token acquired successfully.');

            // === Main Sync Logic (Now within Authentication Success block) ===

            // --- Initial Run / State Load ---
            logger.info(`Loading state from: ${config.stateFilePath}`);
            const currentState = await loadState(config.stateFilePath, logger);
            context.setCurrentState(currentState);
            await context.statusUpdater.updateStatus({ status: 'loading_state', lastSyncTimestamp: context.getLastSyncTimestamp() });
            let lastSyncTime = context.getLastSyncTimestamp();
            logger.info(`Current state loaded. Last sync timestamp: ${lastSyncTime || 'Never'}`);

            // --- Startup Status Logging ---
            logger.info('Gathering startup status information...');
            await context.statusUpdater.updateStatus({ status: 'checking_local_files' });
            const latestLocalDate = await findLatestFileDateRecursive(localSyncDir, logger);
            if (latestLocalDate) {
                logger.info(`Latest file date found locally (${localSyncDir}): ${latestLocalDate.toISOString()}`);
                await context.statusUpdater.updateStatus({ lastLocalFileDate: latestLocalDate.toISOString() });
            } else {
                logger.info(`No files found or error scanning local directory (${localSyncDir}).`);
                await context.statusUpdater.updateStatus({ lastLocalFileDate: null });
            }

            logger.info('Checking latest item in Google Photos...');
            await context.statusUpdater.updateStatus({ status: 'checking_google_photos' });
            const latestMediaItem = await getLatestMediaItem(context.getAccessToken(), logger);
            if (latestMediaItem && latestMediaItem.mediaMetadata && latestMediaItem.mediaMetadata.creationTime) {
                logger.info(`Latest media item creation time in Google Photos: ${latestMediaItem.mediaMetadata.creationTime}`);
                await context.statusUpdater.updateStatus({ lastGooglePhotoDate: latestMediaItem.mediaMetadata.creationTime });
            } else {
                logger.warn('Could not determine the latest media item date from Google Photos.');
                await context.statusUpdater.updateStatus({ lastGooglePhotoDate: null });
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
                    await context.statusUpdater.updateStatus({ status: 'initial_sync_running', currentRunStart: syncTimestamp.toISOString() });
                    const initialSyncResult = await runInitialSync(context.getAccessToken(), config, logger, context.statusUpdater);
                    syncSuccess = initialSyncResult.success;
                    syncItemsDownloaded = initialSyncResult.itemsDownloaded || 0;
                } else {
                    logger.info(`Performing incremental sync (Last sync: ${lastSyncTime})...`);
                    await context.statusUpdater.updateStatus({ status: 'incremental_sync_running', currentRunStart: syncTimestamp.toISOString() });
                    const incrementalSyncResult = await runIncrementalSync(lastSyncTime, context.getAccessToken(), config, logger, context.statusUpdater);
                    syncSuccess = incrementalSyncResult.success;
                    syncItemsDownloaded = incrementalSyncResult.itemsDownloaded || 0;
                }
            } catch (syncErr) {
                logger.error('Error during synchronization process:', syncErr);
                syncSuccess = false;
                syncError = syncErr.message;
                await context.statusUpdater.updateStatus({ status: 'sync_failed', error: syncError });
            }

            // --- Save State After Sync ---
            if (syncSuccess) {
                logger.info(`Sync finished successfully. Items downloaded: ${syncItemsDownloaded}. Updating state...`);
                const newTimestamp = syncTimestamp.toISOString();
                context.updateLastSyncTimestamp(newTimestamp);
                await saveState(config.stateFilePath, context.currentState, logger);
                await context.statusUpdater.updateStatus({
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
                 await context.statusUpdater.updateStatus({
                     status: 'sync_failed',
                     lastRunOutcome: 'failure',
                     lastRunItemsDownloaded: syncItemsDownloaded,
                     lastRunError: syncError || 'Unknown sync error',
                     lastRunFinish: new Date().toISOString()
                 }, logger);

                if (initialRun && !isContinuous) {
                     const syncError = errorHandler.createApiError('Initial sync failed in non-continuous mode');
                     await errorHandler.handleError(syncError, 'Initial Sync', true);
                     return; // Exit main function
                } else if (initialRun && isContinuous) {
                     const syncError = errorHandler.createApiError('Initial sync failed in continuous mode');
                     await errorHandler.handleError(syncError, 'Initial Sync', true);
                     return; // Exit main function
                }
            }

             // === End of Main Sync Logic block ===

        } catch (error) {
            const authError = errorHandler.createAuthenticationError(`Authentication or main sync execution failed: ${error.message}`, error);
            await errorHandler.handleError(authError, 'Authentication/Sync', true);
            return; // Exit main function
        }

        // Continuous Mode Loop (Uses global config)
        if (isContinuous) {
            logger.info(`Entering continuous mode. Checking for updates every ${CONTINUOUS_MODE_INTERVAL_MS / 1000 / 60} minutes.`);
            await context.statusUpdater.updateStatus({ status: 'idle_continuous' });
            while (true) {
                try {
                    logger.info(`Continuous mode: Waiting for ${CONTINUOUS_MODE_INTERVAL_MS / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, CONTINUOUS_MODE_INTERVAL_MS));

                    logger.info("Re-checking Authentication before continuous sync...");
                    const authResult = await authorize(config.credentialsPath, config.stateFilePath, logger);
                     if (!authResult || !authResult.accessToken || !authResult.client) {
                         const reAuthError = errorHandler.createAuthenticationError('Continuous mode: Re-authorization failed');
                         await errorHandler.handleError(reAuthError, 'Continuous Mode Re-auth', true);
                         return; // Exit main function
                     }
                     context.setAuthResult(authResult);
                     logger.info('Continuous mode: Authentication refreshed/verified.');

                    logger.info(`Continuous mode: Performing incremental sync (Last sync: ${lastSyncTime})...`);
                    const loopSyncTimestamp = new Date();
                                            await context.statusUpdater.updateStatus({ status: 'incremental_sync_running', currentRunStart: loopSyncTimestamp.toISOString() });
                    let loopSyncSuccess = false;
                    let loopSyncItemsDownloaded = 0;
                    let loopSyncError = null;

                    try {
                        const incrementalSyncResult = await runIncrementalSync(
                            lastSyncTime,
                            context.getAccessToken(),
                            config,
                            logger,
                            context.statusUpdater
                        );
                        loopSyncSuccess = incrementalSyncResult.success;
                        loopSyncItemsDownloaded = incrementalSyncResult.itemsDownloaded || 0;
                    } catch (loopErr) {
                         logger.error('Continuous mode: Error during incremental sync:', loopErr);
                         loopSyncSuccess = false;
                         loopSyncError = loopErr.message;
                         await context.statusUpdater.updateStatus({ status: 'sync_failed', error: loopSyncError });
                    }

                    if (loopSyncSuccess) {
                        const newTimestamp = loopSyncTimestamp.toISOString();
                        context.updateLastSyncTimestamp(newTimestamp);
                        await saveState(config.stateFilePath, context.currentState, logger);
                        await context.statusUpdater.updateStatus({
                            status: 'idle_continuous',
                            lastSyncTimestamp: newTimestamp,
                            lastRunOutcome: 'success',
                            lastRunItemsDownloaded: loopSyncItemsDownloaded,
                            lastRunError: null,
                            lastRunFinish: new Date().toISOString()
                        });
                        lastSyncTime = newTimestamp;
                        logger.info(`Continuous mode: Incremental sync successful (${loopSyncItemsDownloaded} items). State updated.`);
                    } else {
                         logger.warn('Continuous mode: Incremental sync failed, state not updated.');
                          await context.statusUpdater.updateStatus({
                             status: 'idle_continuous',
                             lastRunOutcome: 'failure',
                             lastRunItemsDownloaded: loopSyncItemsDownloaded,
                             lastRunError: loopSyncError || 'Unknown sync error',
                             lastRunFinish: new Date().toISOString()
                         });
                    }

                } catch (loopError) {
                    logger.error('Continuous mode: Unhandled error in sync loop:', loopError);
                     await context.statusUpdater.updateStatus({
                        status: 'failed_continuous_loop',
                        error: `Loop Error: ${loopError.message}`
                     });
                    logger.warn('Continuous mode: Will retry after the next interval.');
                }
            }
        } else {
             logger.info('Application finished normally (non-continuous mode).');
             await context.statusUpdater.updateStatus({ status: 'idle_finished' });
        }

    } catch (error) {
        const mainError = errorHandler.createApiError(`Unhandled error in main execution scope: ${error.message}`, error);
        await errorHandler.handleError(mainError, 'Main Execution', true);
        if (releaseLock) {
            try { await releaseLock(); } catch (e) { logger.warn('Failed to release lock during error exit:', e.message); }
        }
        return; // Exit main function
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

// --- Graceful Shutdown Handling ---
let exiting = false;
async function gracefulShutdown(signal) {
    if (exiting) return;
    exiting = true;
    
    if (!syncContext) {
        console.error(`Received ${signal}. Context not available for graceful shutdown.`);
        process.exit(0);
        return;
    }

    const { config, logger } = syncContext;
    logger.warn(`Received ${signal}. Shutting down gracefully...`);

    const statusFilePath = config?.statusFilePath;
    const lockFilePathRef = syncContext.lockFilePath;
    const dataDirForShutdown = path.dirname(statusFilePath || './status.json');

    if (statusFilePath) {
        try {
             await syncContext.statusUpdater.updateStatus({ status: 'shutting_down', signal: signal });
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
             await syncContext.statusUpdater.setIdleStatus();
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
process.on('uncaughtException', async (error, origin) => {
    if (syncContext?.errorHandler) {
        const fatalError = syncContext.errorHandler.createApiError(`Uncaught Exception: ${error.message}`, error);
        await syncContext.errorHandler.handleError(fatalError, `Uncaught Exception (${origin})`, true);
    } else {
        console.error('FATAL: Uncaught Exception:', { error: error.message, stack: error.stack, origin: origin });
        process.exit(1);
    }
});
process.on('unhandledRejection', async (reason, promise) => {
    if (syncContext?.errorHandler) {
        const rejectionError = syncContext.errorHandler.createApiError(`Unhandled Promise Rejection: ${reason}`);
        await syncContext.errorHandler.handleError(rejectionError, 'Unhandled Promise Rejection', true);
    } else {
        console.error('FATAL: Unhandled Promise Rejection:', { reason: reason, promise: promise });
        process.exit(1);
    }
});

// --- Run Main ---
if (syncContext) {
    main(syncContext).catch(async e => {
        // Catch any unexpected errors from main itself
        const fatalError = syncContext.errorHandler.createApiError(`Unhandled promise rejection in main function execution: ${e.message}`, e);
        await syncContext.errorHandler.handleError(fatalError, 'Main Function Promise', true);
    });
} else {
    console.error("Skipping main() execution due to initialization failure.");
    // The top-level catch block should have already called process.exit
}

// Export the new function for testing purposes
module.exports = { initializeConfigAndPaths, main }; 