const path = require('path');
const { getAllMediaItems, getAllAlbums, getAlbumMediaItems } = require('./googlePhotosApi');
const { ensureDirectoryExists, downloadMediaItem } = require('./downloader');

/**
 * Performs the initial synchronization.
 * Fetches all albums and their contents, downloading items into album folders.
 * Then fetches all main library items and downloads any not already downloaded via albums.
 * @param {string} accessToken - The Google OAuth2 access token.
 * @param {string} localDirectory - Absolute path to the root local download directory.
 * @param {winston.Logger} logger - Logger instance.
 * @returns {Promise<{success: boolean, albumsProcessed: number, itemsProcessed: number, itemsDownloaded: number, itemsFailed: number}>}
 */
async function runInitialSync(accessToken, localDirectory, logger) {
    logger.info('Starting initial synchronization (including albums)...');
    let albumsProcessed = 0;
    let itemsProcessed = 0; // Total items encountered (album + main library)
    let itemsDownloaded = 0; // Includes skipped existing files
    let itemsFailed = 0;
    const downloadedIds = new Set(); // Track IDs downloaded via albums

    try {
        // 1. Ensure the root directory exists
        await ensureDirectoryExists(localDirectory, logger);

        // 2. Process Albums
        logger.info('--- Processing Albums ---');
        const allAlbums = await getAllAlbums(accessToken, logger);
        albumsProcessed = allAlbums.length;

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
                const albumItems = await getAlbumMediaItems(album.id, accessToken, logger);
                itemsProcessed += albumItems.length; // Add to total count

                logger.info(`Found ${albumItems.length} items in album "${safeAlbumTitle}"`);
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

        // 3. Process Main Library (items not in albums or already downloaded)
        logger.info('--- Processing Main Photo Stream (excluding items already downloaded from albums) ---');
        const allMainMediaItems = await getAllMediaItems(accessToken, logger);
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
        logger.info(`Summary: Albums: ${albumsProcessed}, Total Items Encountered: ${itemsProcessed}, Succeeded/Skipped: ${itemsDownloaded}, Failed: ${itemsFailed}`);
        
        return { success: true, albumsProcessed, itemsProcessed, itemsDownloaded, itemsFailed };

    } catch (error) {
        // Catch critical errors from ensureDirectoryExists, getAllAlbums, or getAllMediaItems
        logger.error(`Initial synchronization failed critically: ${error.message}`);
        return { success: false, albumsProcessed: 0, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: itemsProcessed };
    }
}

// Future: Implement runIncrementalSync

module.exports = { runInitialSync }; 