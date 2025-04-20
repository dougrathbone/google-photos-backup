const path = require('path');
const { getAllMediaItems, getAllAlbums, getAlbumMediaItems, searchMediaItemsByDate } = require('./googlePhotosApi');
const { ensureDirectoryExists, downloadMediaItem } = require('./downloader');

/**
 * Performs the initial synchronization.
 * Fetches albums and media items, respecting debugMaxPages from config.
 * @param {string} accessToken - The Google OAuth2 access token.
 * @param {object} config - The loaded application configuration object.
 * @param {winston.Logger} logger - Logger instance.
 * @returns {Promise<{success: boolean, albumsProcessed: number, itemsProcessed: number, itemsDownloaded: number, itemsFailed: number}>}
 */
async function runInitialSync(accessToken, config, logger) {
    const localDirectory = config.localSyncDirectory;
    const maxPages = config.debugMaxPages || 0; // Use 0 if null/undefined/false
    logger.info('Starting initial synchronization (including albums)...');
    if (maxPages > 0) {
        logger.warn(`*** DEBUG MODE ACTIVE: Fetching max ${maxPages} pages for albums and media items ***`);
    }
    let albumsProcessed = 0;
    let itemsProcessed = 0; // Total items encountered (album + main library)
    let itemsDownloaded = 0; // Includes skipped existing files
    let itemsFailed = 0;
    const downloadedIds = new Set(); // Track IDs downloaded via albums

    try {
        // 1. Ensure the root directory exists
        await ensureDirectoryExists(localDirectory, logger);

        // 2. Process Albums (pass maxPages)
        logger.info('--- Processing Albums ---');
        const allAlbums = await getAllAlbums(accessToken, logger, maxPages);
        albumsProcessed = allAlbums.length; 
        // Note: albumsProcessed might be less than total if maxPages was hit

        for (const album of allAlbums) {
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
                itemsProcessed += albumItems.length; // Add to total count

                logger.info(`Found ${albumItems.length} items in album "${safeAlbumTitle}"` + (maxPages > 0 && albumItems.length >= maxPages * 100 ? ' (Page limit may have been reached)' : '')); // Approx check
                for (const item of albumItems) {
                    try {
                        const success = await downloadMediaItem(item, albumDirectory, logger);
                        if (success) {
                            itemsDownloaded++;
                            downloadedIds.add(item.id); // Mark as downloaded
                        } else {
                            itemsFailed++;
                            logger.warn(`Failed to process item ${item.id} (${item.filename}) in album "${safeAlbumTitle}"`);
                        }
                    } catch (downloadError) {
                        itemsFailed++;
                        logger.error(`Critical error downloading item ${item.id} (${item.filename}) in album "${safeAlbumTitle}": ${downloadError.message}`);
                    }
                     // Optional delay
                     // await new Promise(resolve => setTimeout(resolve, 50));
                }
            } catch (albumError) {
                 logger.error(`Failed to process album "${safeAlbumTitle}" (ID: ${album.id}): ${albumError.message}`);
                 // Decide if this should count as failed items? For now, just log the album error.
            }
        }
        logger.info('--- Finished Processing Albums ---');

        // 3. Process Main Library (pass maxPages)
        logger.info('--- Processing Main Photo Stream (excluding items already downloaded from albums) ---');
        const allMainMediaItems = await getAllMediaItems(accessToken, logger, maxPages);
        let mainStreamItemsAttempted = 0;

        for (const item of allMainMediaItems) {
             // Only process if not already downloaded via an album
            if (!downloadedIds.has(item.id)) {
                itemsProcessed++; // Count this as a distinct item processed
                mainStreamItemsAttempted++;
                try {
                    // Download to the root directory
                    const success = await downloadMediaItem(item, localDirectory, logger);
                    if (success) {
                        itemsDownloaded++;
                        // No need to add to downloadedIds here, as we won't check again
                    } else {
                        itemsFailed++;
                        logger.warn(`Failed to process item ${item.id} (${item.filename}) from main stream`);
                    }
                } catch (downloadError) {
                    itemsFailed++;
                    logger.error(`Critical error downloading item ${item.id} (${item.filename}) from main stream: ${downloadError.message}`);
                }
                // Optional delay
                // await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        logger.info(`Finished processing main stream. Items attempted (not in albums): ${mainStreamItemsAttempted}`);
        logger.info('--- Finished Processing Main Stream ---');

        logger.info('Initial synchronization finished.');
        logger.info(`Summary: Albums Processed (or fetched within page limit): ${albumsProcessed}, Total Items Encountered: ${itemsProcessed}, Succeeded/Skipped: ${itemsDownloaded}, Failed: ${itemsFailed}` + (maxPages > 0 ? ' (Page limit applied)' : ''));
        
        return { success: true, albumsProcessed, itemsProcessed, itemsDownloaded, itemsFailed };

    } catch (error) {
        // Catch critical errors from ensureDirectoryExists, getAllAlbums, or getAllMediaItems
        logger.error(`Initial synchronization failed critically: ${error.message}`);
        return { success: false, albumsProcessed: 0, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: itemsProcessed };
    }
}

/**
 * Performs an incremental synchronization based on the last sync timestamp.
 * Fetches only new media items added since the last sync and downloads them.
 * NOTE: This simplified version downloads new items to the root directory, 
 *       ignoring potential new album memberships for simplicity.
 * @param {string} lastSyncTimestamp - ISO 8601 timestamp of the last successful sync.
 * @param {string} accessToken - The Google OAuth2 access token.
 * @param {string} localDirectory - Absolute path to the root local download directory.
 * @param {winston.Logger} logger - Logger instance.
 * @returns {Promise<{success: boolean, itemsProcessed: number, itemsDownloaded: number, itemsFailed: number}>}
 */
async function runIncrementalSync(lastSyncTimestamp, accessToken, localDirectory, logger) {
    logger.info(`Starting incremental synchronization since ${lastSyncTimestamp}...`);
    let itemsProcessed = 0;
    let itemsDownloaded = 0;
    let itemsFailed = 0;
    const syncStartTime = new Date(); // Use this as the end date for the search

    try {
        // 1. Ensure the root directory exists (might not be strictly necessary, but safe)
        await ensureDirectoryExists(localDirectory, logger);

        // 2. Search for new media items since the last sync
        const newMediaItems = await searchMediaItemsByDate(
            lastSyncTimestamp, 
            syncStartTime.toISOString(), 
            accessToken, 
            logger
        );
        itemsProcessed = newMediaItems.length;
        logger.info(`Found ${itemsProcessed} new items since last sync.`);

        // 3. Download new items
        for (const item of newMediaItems) {
            try {
                 // Download directly to the root directory in this simplified version
                const success = await downloadMediaItem(item, localDirectory, logger);
                if (success) {
                    itemsDownloaded++;
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
        logger.info(`Summary: New Items Found: ${itemsProcessed}, Succeeded/Skipped: ${itemsDownloaded}, Failed: ${itemsFailed}`);
        
        // Consider successful if it ran through all new items without critical API errors
        return { success: true, itemsProcessed, itemsDownloaded, itemsFailed };

    } catch (error) {
        // Catch critical errors from ensureDirectoryExists or searchMediaItemsByDate
        logger.error(`Incremental synchronization failed critically: ${error.message}`);
        return { success: false, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: itemsProcessed };
    }
}

module.exports = { runInitialSync, runIncrementalSync }; 