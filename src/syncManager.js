const path = require('path');
const { getAllMediaItems, getAllAlbums, getAlbumMediaItems, searchMediaItemsByDate } = require('./googlePhotosApi');
const { ensureDirectoryExists, downloadMediaItem } = require('./downloader');

/**
 * Performs the initial synchronization.
 * Fetches albums and media items, respecting debug limits.
 * @param {string} accessToken - The Google OAuth2 access token.
 * @param {object} config - The loaded application configuration object.
 * @param {winston.Logger} logger - Logger instance.
 * @param {object} statusUpdater - StatusUpdater instance for tracking progress.
 * @returns {Promise<{success: boolean, albumsProcessed: number, itemsProcessed: number, itemsDownloaded: number, itemsFailed: number}>}
 */
async function runInitialSync(accessToken, config, logger, statusUpdater = null) {
    const localDirectory = config.localSyncDirectory;
    const maxPages = config.debugMaxPages || 0;
    const maxDownloads = config.debugMaxDownloads || 0; // Get download limit
    let downloadsDone = 0; // Counter for downloads
    
    logger.info('Starting initial synchronization (including albums)...');
    if (maxPages > 0) {
        logger.warn(`*** DEBUG MODE ACTIVE: Fetching max ${maxPages} pages for albums and media items ***`);
    }
    if (maxDownloads > 0) {
         logger.warn(`*** DEBUG MODE ACTIVE: Max ${maxDownloads} downloads will be attempted ***`);
    }
    
    let albumsProcessed = 0;
    let itemsProcessed = 0; 
    let itemsDownloaded = 0; 
    let itemsFailed = 0;
    const downloadedIds = new Set();
    let downloadLimitReached = false; // Flag to break outer loops
    let summary = ''; // To store final summary string

    try {
        // 1. Ensure the root directory exists
        await ensureDirectoryExists(localDirectory, logger);

        // 2. Process Albums
        logger.info('--- Processing Albums ---');
        const allAlbums = await getAllAlbums(accessToken, logger, maxPages);
        albumsProcessed = allAlbums.length; 

        if (statusUpdater) await statusUpdater.setSyncStartStatus('initial', 0, null); // Initial item count unknown

        for (const album of allAlbums) {
            if (downloadLimitReached) break; // Stop processing albums if limit hit
            if (!album.title) {
                logger.warn(`Album found with no title (ID: ${album.id}), skipping.`);
                continue;
            }
            // Sanitize album title for directory name (simple example)
            const safeAlbumTitle = album.title.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim() || 'Untitled Album';
            const albumDirectory = path.join(localDirectory, safeAlbumTitle);
            logger.info(`Processing Album: "${safeAlbumTitle}" (ID: ${album.id})`);
            
            try {
                await ensureDirectoryExists(albumDirectory, logger);
                const albumItems = await getAlbumMediaItems(album.id, accessToken, logger, maxPages);
                // Update total items once known for the album
                if (statusUpdater) {
                    const currentStatus = statusUpdater.getCurrentStatus();
                    await statusUpdater.updateStatus({ 
                        currentRunTotalItems: currentStatus.currentRunTotalItems + albumItems.length 
                    });
                }
                itemsProcessed += albumItems.length; 
                logger.info(`Found ${albumItems.length} items in album "${safeAlbumTitle}"...`);

                for (const item of albumItems) {
                    // Check download limit BEFORE attempting download
                    if (maxDownloads > 0 && downloadsDone >= maxDownloads) {
                        logger.warn(`Reached debug download limit (${maxDownloads}). Stopping further downloads.`);
                        downloadLimitReached = true;
                        break; // Break inner item loop
                    }
                    try {
                        const success = await downloadMediaItem(item, albumDirectory, logger);
                        if (success) {
                            itemsDownloaded++;
                            downloadsDone++; // Increment counter only on successful/skipped download
                            downloadedIds.add(item.id);
                            if (statusUpdater) await statusUpdater.incrementDownloadedCount(); // Increment status
                        } else {
                            itemsFailed++;
                            logger.warn(`Failed to process item ${item.id} (${item.filename}) in album "${safeAlbumTitle}"`);
                        }
                    } catch (downloadError) {
                        itemsFailed++;
                        logger.error(`Critical error downloading item ${item.id} (${item.filename}) in album "${safeAlbumTitle}": ${downloadError.message}`);
                    }
                }
            } catch (albumError) {
                 logger.error(`Failed to process album "${safeAlbumTitle}" (ID: ${album.id}): ${albumError.message}`);
                 // Decide if this should count as failed items? For now, just log the album error.
            }
        }
        logger.info('--- Finished Processing Albums ---');

        // 3. Process Main Library 
        logger.info('--- Processing Main Photo Stream ... ---');
        if (downloadLimitReached) {
             logger.warn('Skipping main stream processing due to download limit reached during album processing.');
        } else {
            const allMainMediaItems = await getAllMediaItems(accessToken, logger, maxPages);
            let mainStreamItemsAttempted = 0;

            // Update total items once known for main stream
            if (statusUpdater) {
                const currentStatus = statusUpdater.getCurrentStatus();
                await statusUpdater.updateStatus({ 
                    currentRunTotalItems: currentStatus.currentRunTotalItems + allMainMediaItems.filter(i => !downloadedIds.has(i.id)).length
                });
            }

            for (const item of allMainMediaItems) {
                if (downloadLimitReached) break; // Check limit again for main stream
                if (!downloadedIds.has(item.id)) {
                    itemsProcessed++; 
                    mainStreamItemsAttempted++;
                     // Check download limit BEFORE attempting download
                    if (maxDownloads > 0 && downloadsDone >= maxDownloads) {
                        logger.warn(`Reached debug download limit (${maxDownloads}). Stopping further downloads.`);
                        downloadLimitReached = true;
                        break; // Break main stream loop
                    }
                    try {
                        const success = await downloadMediaItem(item, localDirectory, logger);
                        if (success) {
                            itemsDownloaded++;
                            downloadsDone++; // Increment counter
                            if (statusUpdater) await statusUpdater.incrementDownloadedCount(); // Increment status
                        } else {
                            itemsFailed++;
                            logger.warn(`Failed to process item ${item.id} (${item.filename}) from main stream`);
                        }
                    } catch (downloadError) {
                        itemsFailed++;
                        logger.error(`Critical error downloading item ${item.id} (${item.filename}) from main stream: ${downloadError.message}`);
                    }
                }
            }
            logger.info(`Finished processing main stream. Items attempted (not in albums): ${mainStreamItemsAttempted}`);
        }
        logger.info('--- Finished Processing Main Stream ---');

        logger.info('Initial synchronization finished.');
        summary = `Summary: Albums Processed: ${albumsProcessed}, Total Items Encountered: ${itemsProcessed}, Succeeded/Skipped: ${itemsDownloaded}, Failed: ${itemsFailed}` + (maxPages > 0 ? ' (Page limit applied)' : '') + (maxDownloads > 0 && downloadLimitReached ? ' (Download limit reached)' : '');
        logger.info(summary);
        if (statusUpdater) await statusUpdater.setSyncEndStatus(true, summary); // Update status on success
        
        return { success: true, albumsProcessed, itemsProcessed, itemsDownloaded, itemsFailed };

    } catch (error) {
        summary = `Initial sync failed critically: ${error.message}`;
        logger.error(summary);
        if (statusUpdater) await statusUpdater.setSyncEndStatus(false, summary); // Update status on failure
        return { success: false, albumsProcessed: 0, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: 0 }; // Return original structure on error
    }
}

/**
 * Performs an incremental synchronization based on the last sync timestamp.
 * Fetches only new media items added since the last sync and downloads them.
 * NOTE: This simplified version downloads new items to the root directory, 
 *       ignoring potential new album memberships for simplicity.
 * @param {string} lastSyncTimestamp - ISO 8601 timestamp of the last successful sync.
 * @param {string} accessToken - The Google OAuth2 access token.
 * @param {object} config - The loaded application configuration object.
 * @param {winston.Logger} logger - Logger instance.
 * @param {object} statusUpdater - StatusUpdater instance for tracking progress.
 * @returns {Promise<{success: boolean, itemsProcessed: number, itemsDownloaded: number, itemsFailed: number}>}
 */
async function runIncrementalSync(lastSyncTimestamp, accessToken, config, logger, statusUpdater = null) {
    const localDirectory = config.localSyncDirectory;
    const maxDownloads = config.debugMaxDownloads || 0; // Get download limit
    let downloadsDone = 0; // Counter
    let summary = '';

    logger.info(`Starting incremental synchronization since ${lastSyncTimestamp}...`);
     if (maxDownloads > 0) {
         logger.warn(`*** DEBUG MODE ACTIVE: Max ${maxDownloads} downloads will be attempted ***`);
    }
    let itemsProcessed = 0;
    let itemsDownloaded = 0;
    let itemsFailed = 0;
    const syncStartTime = new Date(); // Use this as the end date for the search

    try {
        // 1. Ensure the root directory exists (might not be strictly necessary, but safe)
        await ensureDirectoryExists(localDirectory, logger);

        if (statusUpdater) await statusUpdater.setSyncStartStatus('incremental', 0, lastSyncTimestamp); // Item count unknown initially

        // 2. Search for new media items since the last sync
        const newMediaItems = await searchMediaItemsByDate(
            lastSyncTimestamp, 
            syncStartTime.toISOString(), 
            accessToken, 
            logger
        );
        itemsProcessed = newMediaItems.length;
         // Update status with actual count
        if (statusUpdater) await statusUpdater.updateStatus({ currentRunTotalItems: itemsProcessed });
        logger.info(`Found ${itemsProcessed} new items since last sync.`);

        // 3. Download new items
        for (const item of newMediaItems) {
             // Check download limit BEFORE attempting download
            if (maxDownloads > 0 && downloadsDone >= maxDownloads) {
                logger.warn(`Reached debug download limit (${maxDownloads}). Stopping further downloads.`);
                break; // Break download loop
            }
            try {
                const success = await downloadMediaItem(item, localDirectory, logger);
                if (success) {
                    itemsDownloaded++;
                    downloadsDone++; // Increment counter
                    if (statusUpdater) await statusUpdater.incrementDownloadedCount(); // Increment status
                } else {
                    itemsFailed++;
                    logger.warn(`Failed to process new item ${item.id} (${item.filename})`);
                }
            } catch (downloadError) {
                itemsFailed++;
                logger.error(`Critical error downloading new item ${item.id} (${item.filename}): ${downloadError.message}`);
                // Decide whether to continue or stop? Log and continue.
            }
            // Optional delay
            // await new Promise(resolve => setTimeout(resolve, 50));
        }

        logger.info('Incremental synchronization finished.');
        summary = `Summary: New Items Found: ${itemsProcessed}, Succeeded/Skipped: ${itemsDownloaded}, Failed: ${itemsFailed}` + (maxDownloads > 0 && downloadsDone >= maxDownloads ? ' (Download limit reached)' : '');
        logger.info(summary);
        if (statusUpdater) await statusUpdater.setSyncEndStatus(true, summary); // Update status on success
        
        return { success: true, itemsProcessed, itemsDownloaded, itemsFailed };

    } catch (error) {
        summary = `Incremental sync failed critically: ${error.message}`;
        logger.error(summary);
        if (statusUpdater) await statusUpdater.setSyncEndStatus(false, summary); // Update status on failure
        return { success: false, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: 0 }; // Return original structure on error
    }
}

module.exports = { runInitialSync, runIncrementalSync }; 