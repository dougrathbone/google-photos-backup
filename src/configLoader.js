const fs = require('fs');
const path = require('path');

/**
 * Loads and validates configuration from a JSON file.
 * @param {string} filePath - The absolute path to the configuration file.
 * @returns {object} The loaded configuration object.
 * @throws {Error} If the file doesn't exist, is unreadable, invalid JSON, or missing required keys.
 */
function loadConfig(filePath) {
    console.log(`Attempting to load configuration from: ${filePath}`); // Initial log before logger is configured
    if (!fs.existsSync(filePath)) {
        throw new Error(`Configuration file not found at ${filePath}`);
    }

    let configData;
    try {
        configData = fs.readFileSync(filePath, 'utf8');
    } catch (readError) {
        throw new Error(`Error reading configuration file at ${filePath}: ${readError.message}`);
    }

    let config;
    try {
        config = JSON.parse(configData);
    } catch (parseError) {
        throw new Error(`Error parsing configuration file at ${filePath}: ${parseError.message}`);
    }

    console.log("Configuration loaded successfully."); // Still using console here

    const requiredKeys = ['localSyncDirectory', 'syncIntervalHours', 'credentialsPath', 'logFilePath', 'stateFilePath'];
    const optionalKeys = ['debugMaxPages', 'debugMaxDownloads'];
    
    const missingKeys = requiredKeys.filter(key => !(key in config));
    if (missingKeys.length > 0) {
        throw new Error(`Missing required configuration keys: ${missingKeys.join(', ')}`);
    }

    // Validate optional debugMaxPages if present
    if (config.debugMaxPages !== undefined && config.debugMaxPages !== null) {
        if (typeof config.debugMaxPages !== 'number' || !Number.isInteger(config.debugMaxPages) || config.debugMaxPages < 0) {
            throw new Error('Invalid configuration: debugMaxPages must be a non-negative integer or null/0.');
        }
    } else {
        // Ensure it's set to 0 if null or undefined for easier checks later
        config.debugMaxPages = 0;
    }

    // Validate optional debugMaxDownloads if present
    if (config.debugMaxDownloads !== undefined && config.debugMaxDownloads !== null) {
        if (typeof config.debugMaxDownloads !== 'number' || !Number.isInteger(config.debugMaxDownloads) || config.debugMaxDownloads < 0) {
            throw new Error('Invalid configuration: debugMaxDownloads must be a non-negative integer or null/0.');
        }
    } else {
        // Ensure it's set to 0 if null or undefined for easier checks later
        config.debugMaxDownloads = 0;
    }

    // Resolve relative paths in config to absolute paths based on config file's directory
    const configDir = path.dirname(filePath);
    config.localSyncDirectory = path.resolve(configDir, config.localSyncDirectory);
    config.credentialsPath = path.resolve(configDir, config.credentialsPath);
    config.logFilePath = path.resolve(configDir, config.logFilePath);
    config.stateFilePath = path.resolve(configDir, config.stateFilePath);

    return config;
}

module.exports = { loadConfig }; 