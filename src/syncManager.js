const { getAllMediaItems } = require('./googlePhotosApi');
const { ensureDirectoryExists, downloadMediaItem } = require('./downloader');

/**
 * Performs the initial synchronization.
 * Fetches all media items and attempts to download each one.
 * @param {OAuth2Client} authClient - Authorized Google API client.
 * @param {string} localDirectory - Absolute path to the local download directory.
 * @param {winston.Logger} logger - Logger instance.
 * @returns {Promise<{success: boolean, itemsProcessed: number, itemsDownloaded: number, itemsFailed: number}>}
 */
async function runInitialSync(authClient, localDirectory, logger) {
    logger.info('Starting initial synchronization...');
    let itemsProcessed = 0;
    let itemsDownloaded = 0; // Includes skipped existing files
    let itemsFailed = 0;

    try {
        // 1. Ensure the target directory exists
        await ensureDirectoryExists(localDirectory, logger);

        // 2. Fetch all media item metadata
        // This can throw if the API call fails critically
        const allMediaItems = await getAllMediaItems(authClient, logger);
        itemsProcessed = allMediaItems.length;
        logger.info(`Total items to process for initial sync: ${itemsProcessed}`);

        // 3. Download each item sequentially for simplicity (can be parallelized later)
        for (const item of allMediaItems) {
            try {
                const success = await downloadMediaItem(item, localDirectory, logger);
                if (success) {
                    itemsDownloaded++;
                } else {
                    itemsFailed++;
                    logger.warn(`Failed to process item ${item.id} (${item.filename})`);
                }
            } catch (downloadError) {
                // Catch errors from downloadMediaItem promise rejection (e.g., write errors)
                itemsFailed++;
                logger.error(`Critical error downloading item ${item.id} (${item.filename}): ${downloadError.message}`);
                // Decide whether to continue or stop? For now, log and continue.
            }
            // Optional: Add a small delay here if hitting rate limits during download
            // await new Promise(resolve => setTimeout(resolve, 100)); 
        }

        logger.info('Initial synchronization finished.');
        logger.info(`Summary: Processed: ${itemsProcessed}, Succeeded/Skipped: ${itemsDownloaded}, Failed: ${itemsFailed}`);
        
        // If even one download failed, maybe return success: false?
        // For now, consider it successful if it ran through all items without critical API errors.
        return { success: true, itemsProcessed, itemsDownloaded, itemsFailed };

    } catch (error) {
        // Catch critical errors from ensureDirectoryExists or getAllMediaItems
        logger.error(`Initial synchronization failed critically: ${error.message}`);
        return { success: false, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: itemsProcessed };
    }
}

// Future: Implement runIncrementalSync

module.exports = { runInitialSync }; 