const fs = require('fs').promises;
const path = require('path');

/**
 * Recursively finds the most recent modification time of any file
 * within a directory.
 * @param {string} dirPath The path to the directory to scan.
 * @param {winston.Logger} logger The logger instance.
 * @returns {Promise<Date|null>} The Date object of the most recent file modification, or null if dir is empty/not found.
 */
async function findLatestFileDateRecursive(dirPath, logger) {
    let latestDate = null;
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                const latestInSubdir = await findLatestFileDateRecursive(fullPath, logger);
                if (latestInSubdir && (!latestDate || latestInSubdir > latestDate)) {
                    latestDate = latestInSubdir;
                }
            } else if (entry.isFile()) {
                try {
                    const stats = await fs.stat(fullPath);
                    if (!latestDate || stats.mtime > latestDate) {
                        latestDate = stats.mtime;
                    }
                } catch (statError) {
                    // Ignore errors for single files (e.g., permission issues), but log them
                    logger.warn(`Could not get stats for file ${fullPath}: ${statError.message}`);
                }
            }
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.info(`Local sync directory ${dirPath} not found or is empty.`);
        } else {
            logger.error(`Error scanning directory ${dirPath}: ${err.message}`);
        }
        return null; // Return null if directory doesn't exist or on error
    }
    return latestDate;
}

module.exports = { findLatestFileDateRecursive }; 