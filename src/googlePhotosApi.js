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
 * @param {number} [maxPages=0] - Maximum number of pages to fetch (0 for no limit).
 * @returns {Promise<Array<object>>} A list of all media item objects.
 * @throws {Error} If a critical API error occurs.
 */
async function getAllMediaItems(accessToken, logger, maxPages = 0) {
    logger.info('Starting to fetch all media items...' + (maxPages > 0 ? ` (Debug Limit: ${maxPages} pages)` : ''));
    const photos = new Photos(accessToken);
    const allMediaItems = [];
    let pageToken = null;
    let pageCount = 0;
    const pageSize = 100; // A common page size, adjust if needed for this library

    try {
        do {
            pageCount++;
            if (maxPages > 0 && pageCount > maxPages) {
                logger.warn(`Reached debug page limit (${maxPages}) for media items. Results may be incomplete.`);
                break;
            }
            logger.debug(`Fetching page ${pageCount} of media items...`);
            const response = await photos.mediaItems.list(pageSize, pageToken);

            // Check response before accessing properties
            if (response && response.mediaItems && response.mediaItems.length > 0) {
                const items = response.mediaItems;
                logger.info(`Fetched ${items.length} items on page ${pageCount}.`);
                allMediaItems.push(...items);
            } else {
                logger.info(`No items found on page ${pageCount}.`);
                // Break if no items and no next page token to avoid extra loop
                if (!response?.nextPageToken) break; 
            }
            // Use optional chaining for safety
            pageToken = response?.nextPageToken;
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

/**
 * Fetches all albums from the user's Google Photos library.
 * Handles pagination automatically. Stops after maxPages if provided.
 * @param {string} accessToken - The Google OAuth2 access token.
 * @param {winston.Logger} logger - The logger instance.
 * @param {number} [maxPages=0] - Maximum number of pages to fetch (0 for no limit).
 * @returns {Promise<Array<object>>} A list of all album objects.
 * @throws {Error} If a critical API error occurs.
 */
async function getAllAlbums(accessToken, logger, maxPages = 0) {
    logger.info('Starting to fetch albums...' + (maxPages > 0 ? ` (Debug Limit: ${maxPages} pages)` : ''));
    const photos = new Photos(accessToken);
    const albums = [];
    let pageToken = null;
    let pageCount = 0;
    const pageSize = 50; // Max page size for albums

    try {
        do {
            pageCount++;
            if (maxPages > 0 && pageCount > maxPages) {
                logger.warn(`Reached debug page limit (${maxPages}) for albums. Results may be incomplete.`);
                break;
            }
            logger.debug(`Fetching page ${pageCount} of albums...`);
            // Assuming the albums.list method takes pageSize and pageToken
            // This might need adjustment based on actual library behavior.
            const response = await photos.albums.list(pageSize, pageToken);

            const items = response.albums;
            if (items && items.length > 0) {
                logger.info(`Fetched ${items.length} albums on page ${pageCount}.`);
                albums.push(...items);
            } else {
                logger.info(`No albums found on page ${pageCount}.`);
                if (!response.nextPageToken) break;
            }

            pageToken = response.nextPageToken;
            if (pageToken) {
                logger.debug(`Next page token received for albums, continuing fetch...`);
            }

        } while (pageToken);

        logger.info(`Finished fetching albums. Total albums found: ${albums.length}`);
        return albums;

    } catch (err) {
        logger.error(`Error fetching albums (page ${pageCount}) via googlephotos: ${err.message || err}`);
         if (err.response?.data) {
            logger.error('API Error Details:', err.response.data);
        }
        // NOTE: This call might fail due to API policy changes if using restricted scopes
        throw new Error(`Failed to fetch all albums: ${err.message || err}`);
    }
}

/**
 * Searches for media items within a specific album.
 * Handles pagination automatically. Stops after maxPages if provided.
 * @param {string} albumId - The ID of the album to search within.
 * @param {string} accessToken - The Google OAuth2 access token.
 * @param {winston.Logger} logger - The logger instance.
 * @param {number} [maxPages=0] - Maximum number of pages to fetch (0 for no limit).
 * @returns {Promise<Array<object>>} A list of all media item objects in the album.
 * @throws {Error} If a critical API error occurs.
 */
async function getAlbumMediaItems(albumId, accessToken, logger, maxPages = 0) {
    logger.info(`Fetching media items for album ID: ${albumId}...` + (maxPages > 0 ? ` (Debug Limit: ${maxPages} pages)` : ''));
    const photos = new Photos(accessToken);
    const mediaItems = [];
    let pageToken = null;
    let pageCount = 0;
    const pageSize = 100; // Max page size for search

    try {
        do {
            pageCount++;
            if (maxPages > 0 && pageCount > maxPages) {
                logger.warn(`Reached debug page limit (${maxPages}) for album ${albumId}. Album item results may be incomplete.`);
                break;
            }
            logger.debug(`Fetching page ${pageCount} of media items for album ${albumId}...`);
            const response = await photos.mediaItems.search(albumId, pageSize, pageToken);

            // Check response before accessing properties
            if (response && response.mediaItems && response.mediaItems.length > 0) {
                const items = response.mediaItems;
                logger.info(`Fetched ${items.length} items on page ${pageCount} for album ${albumId}.`);
                mediaItems.push(...items);
            } else {
                logger.info(`No items found on page ${pageCount} for album ${albumId}.`);
                 // Break if no items and no next page token
                 if (!response?.nextPageToken) break;
            }
            // Use optional chaining for safety
            pageToken = response?.nextPageToken;
            if (pageToken) {
                logger.debug(`Next page token received for album items, continuing fetch...`);
            }

        } while (pageToken);

        logger.info(`Finished fetching items for album ${albumId}. Total items found: ${mediaItems.length}`);
        return mediaItems;

    } catch (err) {
        logger.error(`Error searching media items for album ${albumId} (page ${pageCount}) via googlephotos: ${err.message || err}`);
         if (err.response?.data) {
            logger.error('API Error Details:', err.response.data);
        }
        // NOTE: This call might fail due to API policy changes if using restricted scopes
        throw new Error(`Failed to fetch items for album ${albumId}: ${err.message || err}`);
    }
}

/**
 * Searches for media items created within a given date range.
 * Handles pagination automatically.
 * @param {string} startDateISO - ISO 8601 timestamp for the start of the range (exclusive).
 * @param {string} endDateISO - ISO 8601 timestamp for the end of the range (inclusive).
 * @param {string} accessToken - The Google OAuth2 access token.
 * @param {winston.Logger} logger - The logger instance.
 * @returns {Promise<Array<object>>} A list of media item objects created in the range.
 * @throws {Error} If a critical API error occurs.
 */
async function searchMediaItemsByDate(startDateISO, endDateISO, accessToken, logger) {
    logger.info(`Searching for media items created after ${startDateISO} up to ${endDateISO}...`);
    const photos = new Photos(accessToken);
    const mediaItems = [];
    let pageToken = null;
    let pageCount = 0;
    const pageSize = 100;

    // Construct the date filter
    // Ensure dates are in the format Google API expects (YYYY, M, D)
    // Note: The API uses creationTime metadata for filtering.
    const startDate = new Date(startDateISO);
    const endDate = new Date(endDateISO);
    const filters = {
        dateFilter: {
            ranges: [{
                // Convert to Date objects and extract year, month, day
                // Adjust month (0-indexed) and potentially handle timezone carefully if needed
                startDate: {
                    year: startDate.getUTCFullYear(),
                    month: startDate.getUTCMonth() + 1,
                    day: startDate.getUTCDate()
                },
                endDate: {
                    year: endDate.getUTCFullYear(),
                    month: endDate.getUTCMonth() + 1,
                    day: endDate.getUTCDate()
                }
            }]
        },
        // Include only non-archived media by default? Add if needed:
        // includeArchivedMedia: false,
        // contentFilter: {} // Add content filters if desired
    };

    logger.debug('Using date filter:', JSON.stringify(filters.dateFilter));

    try {
        do {
            pageCount++;
            logger.debug(`Fetching page ${pageCount} of media items by date range...`);
            
            // Assuming mediaItems.search accepts a filter object
            // This part is speculative based on common API patterns and might need adjustment 
            // depending on the exact behavior of the 'googlephotos' library's search method.
            // It might require constructing the filter differently or using specific options.
            const response = await photos.mediaItems.search(filters, pageSize, pageToken);

            // Check response before accessing properties
            if (response && response.mediaItems && response.mediaItems.length > 0) {
                 // Filter results more precisely as the API date filter might be inclusive/exclusive differently than expected
                 // or might only filter by day, not time.
                 const filteredItems = response.mediaItems.filter(item => {
                     if (!item.mediaMetadata?.creationTime) return false;
                     const creationTime = new Date(item.mediaMetadata.creationTime);
                     // Filter should be: startDate < creationTime <= endDate
                     return creationTime > startDate && creationTime <= endDate;
                 });

                if (filteredItems.length > 0) {
                    logger.info(`Fetched ${response.mediaItems.length} items on page ${pageCount}, ${filteredItems.length} within precise date range.`);
                    mediaItems.push(...filteredItems);
                } else {
                     logger.info(`Fetched ${response.mediaItems.length} items on page ${pageCount}, but none within precise date range.`);
                }
            } else {
                logger.info(`No items found on page ${pageCount}.`);
                 // Break if no items and no next page token
                 if (!response?.nextPageToken) break;
            }
            // Use optional chaining for safety
            pageToken = response?.nextPageToken;
            if (pageToken) {
                logger.debug(`Next page token received, continuing date search...`);
            }

        } while (pageToken);

        logger.info(`Finished searching by date. Total items found in range: ${mediaItems.length}`);
        return mediaItems;

    } catch (err) {
        logger.error(`Error searching media items by date (page ${pageCount}) via googlephotos: ${err.message || err}`);
         if (err.response?.data) {
            logger.error('API Error Details:', err.response.data);
        }
        // NOTE: This call might fail due to API policy changes
        throw new Error(`Failed to search media items by date: ${err.message || err}`);
    }
}

module.exports = { getLatestMediaItem, getAllMediaItems, getAllAlbums, getAlbumMediaItems, searchMediaItemsByDate }; 