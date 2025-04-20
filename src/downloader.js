const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const axios = require('axios');

/**
 * Ensures the target directory exists.
 * @param {string} dirPath - The absolute path to the directory.
 * @param {winston.Logger} logger - The logger instance.
 */
async function ensureDirectoryExists(dirPath, logger) {
    try {
        await fsPromises.mkdir(dirPath, { recursive: true });
        logger.debug(`Ensured directory exists: ${dirPath}`);
    } catch (err) {
        logger.error(`Failed to create or access directory ${dirPath}: ${err.message}`);
        throw new Error(`Directory creation/access failed: ${err.message}`);
    }
}

/**
 * Generates a unique local filename to avoid collisions.
 * Appends the first 8 chars of the media item ID before the extension.
 * Example: image.jpg -> image_a1b2c3d4.jpg
 * @param {string} originalFilename - The original filename from Google Photos.
 * @param {string} mediaId - The unique ID of the media item.
 * @returns {string} The modified unique filename.
 */
function generateUniqueFilename(originalFilename, mediaId) {
    const ext = path.extname(originalFilename);
    const baseName = path.basename(originalFilename, ext);
    const idSuffix = mediaId.substring(0, 8); // Use first 8 chars of ID
    // Sanitize baseName further if needed (e.g., remove invalid characters)
    return `${baseName}_${idSuffix}${ext}`;
}

/**
 * Downloads a media item from its base URL to the specified local path.
 * @param {object} mediaItem - The media item object from Google Photos API.
 * @param {string} localDirectory - The absolute path to the local directory.
 * @param {winston.Logger} logger - The logger instance.
 * @param {function} unlinkFn - Function to use for unlinking files (defaults to fs.promises.unlink).
 * @returns {Promise<boolean>} True if download was successful, false otherwise.
 */
async function downloadMediaItem(mediaItem, localDirectory, logger, unlinkFn = fsPromises.unlink) {
    if (!mediaItem.baseUrl) {
        logger.warn(`Media item ${mediaItem.id} (${mediaItem.filename}) has no baseUrl, cannot download.`);
        return false;
    }
    if (!mediaItem.filename) {
        logger.warn(`Media item ${mediaItem.id} has no filename, cannot save.`);
        return false;
    }

    const uniqueFilename = generateUniqueFilename(mediaItem.filename, mediaItem.id);
    const localFilePath = path.join(localDirectory, uniqueFilename);

    // Check if file already exists (simple check, could be more robust)
    try {
        await fsPromises.access(localFilePath);
        logger.info(`File already exists, skipping download: ${uniqueFilename}`);
        return true; // Consider existing file as success for initial sync
    } catch (err) {
        // File doesn't exist, proceed with download
    }

    // Parameter to download media bytes (photo) or video bytes
    const downloadParam = mediaItem.mediaMetadata.video ? '=dv' : '=d';
    const downloadUrl = `${mediaItem.baseUrl}${downloadParam}`;

    logger.debug(`Attempting download: ${mediaItem.filename} (ID: ${mediaItem.id}) -> ${uniqueFilename}`);

    try {
        const response = await axios({
            method: 'get',
            url: downloadUrl,
            responseType: 'stream',
        });

        const writer = fs.createWriteStream(localFilePath);

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                logger.info(`Successfully downloaded: ${uniqueFilename}`);
                resolve(true);
            });
            writer.on('error', (err) => {
                logger.error(`Error writing file ${uniqueFilename}: ${err.message}`);
                unlinkFn(localFilePath);
                reject(err);
            });
            response.data.on('error', (err) => {
                logger.error(`Error during download stream for ${uniqueFilename}: ${err.message}`);
                writer.close();
                unlinkFn(localFilePath);
                reject(err);
            });
        });

    } catch (error) {
        logger.error(`Failed to download ${uniqueFilename} from ${downloadUrl}: ${error.message}`);
        if (error.response) {
            // Log details if it's an axios HTTP error
            logger.error(`Download error status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
        }
        return false;
    }
}

module.exports = { ensureDirectoryExists, downloadMediaItem }; 