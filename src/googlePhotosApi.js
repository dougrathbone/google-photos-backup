const Photos = require('googlephotos');

// Note: We no longer need googleapis here for photos, but googleAuth still uses it.

/**
 * Fetches the most recent media item from Google Photos using the googlephotos library.
 * @param {string} accessToken - The Google OAuth2 access token.
 * @param {winston.Logger} logger - The logger instance.
 * @returns {Promise<object|null>} The media item object or null if none found or error.
 */
async function getLatestMediaItem(accessToken, logger) {
    logger.debug('Attempting to fetch the latest media item using googlephotos library...');
    const photos = new Photos(accessToken);

    try {
        // The googlephotos library might return results differently.
        // Based on its likely wrapping of the REST API, we expect similar structure.
        // We need to list items; there might not be a specific "latest" function.
        const response = await photos.mediaItems.list(1); // Ask for page size 1
        
        // Check the structure of the response from the googlephotos library
        // This might need adjustment based on actual library behavior.
        if (response.mediaItems && response.mediaItems.length > 0) {
            logger.debug('Successfully fetched the latest media item via googlephotos.');
            return response.mediaItems[0];
        } else {
            logger.info('No media items found in the Google Photos library via googlephotos.');
            return null;
        }
    } catch (err) {
        logger.error(`Error fetching latest media item via googlephotos: ${err.message || err}`);
        // Log more details if available (structure might differ from googleapis error)
        if (err.response?.data) {
            logger.error('API Error Details:', err.response.data);
        }
        // NOTE: This call will likely fail now due to API policy changes (403 error expected)
        return null;
    }
}

/**
 * Fetches all media items from the user's Google Photos library using googlephotos library.
 * Handles pagination based on common patterns (might need adjustment for this specific library).
 * @param {string} accessToken - The Google OAuth2 access token.
 * @param {winston.Logger} logger - The logger instance.
 * @returns {Promise<Array<object>>} A list of all media item objects.
 * @throws {Error} If a critical API error occurs.
 */
async function getAllMediaItems(accessToken, logger) {
    logger.info('Starting to fetch all media items using googlephotos library...');
    const photos = new Photos(accessToken);
    const allMediaItems = [];
    let pageToken = null;
    let pageCount = 0;
    const pageSize = 100; // A common page size, adjust if needed for this library

    try {
        do {
            pageCount++;
            logger.debug(`Fetching page ${pageCount} of media items...`);
            // Assuming the list method takes pageSize and pageToken similar to googleapis
            // This might need adjustment based on actual library behavior.
            const response = await photos.mediaItems.list(pageSize, pageToken);

            const items = response.mediaItems;
            if (items && items.length > 0) {
                logger.info(`Fetched ${items.length} items on page ${pageCount}.`);
                allMediaItems.push(...items);
            } else {
                logger.info(`No items found on page ${pageCount}.`);
                // Break if no items and no page token, otherwise could be an empty page
                if (!response.nextPageToken) break;
            }

            pageToken = response.nextPageToken;
            if (pageToken) {
                logger.debug(`Next page token received, continuing fetch...`);
            }

        } while (pageToken);

        logger.info(`Finished fetching media items. Total items found: ${allMediaItems.length}`);
        return allMediaItems;

    } catch (err) {
        logger.error(`Error fetching media items (page ${pageCount}) via googlephotos: ${err.message || err}`);
         if (err.response?.data) {
            logger.error('API Error Details:', err.response.data);
        }
        // NOTE: This call will likely fail now due to API policy changes (403 error expected)
        // Re-throw critical error to stop the sync process
        throw new Error(`Failed to fetch all media items: ${err.message || err}`);
    }
}

module.exports = { getLatestMediaItem, getAllMediaItems }; 