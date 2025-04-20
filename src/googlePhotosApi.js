const { google } = require('googleapis');

/**
 * Fetches the most recent media item from Google Photos.
 * @param {OAuth2Client} authClient An authorized OAuth2 client.
 * @param {winston.Logger} logger The logger instance.
 * @returns {Promise<object|null>} The media item object or null if none found or error.
 */
async function getLatestMediaItem(authClient, logger) {
    logger.debug('Attempting to fetch the latest media item from Google Photos...');
    
    // Alternative instantiation: Initialize API version first
    const photosApi = google.photoslibrary('v1'); 
    
    try {
        // Set auth on the request options instead of the client instance
        const response = await photosApi.mediaItems.list({
            pageSize: 1, // We only need the most recent one
            auth: authClient // Pass auth client here
        });

        if (response.data.mediaItems && response.data.mediaItems.length > 0) {
            logger.debug('Successfully fetched the latest media item.');
            return response.data.mediaItems[0];
        } else {
            logger.info('No media items found in the Google Photos library.');
            return null;
        }
    } catch (err) {
        logger.error(`Error fetching latest media item from Google Photos API: ${err.message}`);
        if (err.response?.data?.error) {
            logger.error('API Error Details:', err.response.data.error);
        }
        // Handle specific errors like invalid credentials or permissions if needed
        // e.g., if (err.code === 401 || err.code === 403)
        return null;
    }
}

module.exports = { getLatestMediaItem }; 