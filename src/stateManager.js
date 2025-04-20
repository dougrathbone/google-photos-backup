const fs = require('fs').promises;

/**
 * Represents the default state structure.
 */
const defaultState = {
    lastSyncTimestamp: null, // ISO 8601 string or null
    // Can add other state properties here later, e.g., downloaded IDs if needed
};

/**
 * Loads the synchronization state from the specified file.
 * If the file doesn't exist or is invalid, returns the default state.
 * @param {string} stateFilePath - The absolute path to the state file.
 * @param {winston.Logger} logger - The logger instance.
 * @returns {Promise<object>} The loaded state object or the default state.
 */
async function loadState(stateFilePath, logger) {
    logger.debug(`Attempting to load state from: ${stateFilePath}`);
    try {
        const stateData = await fs.readFile(stateFilePath, 'utf8');
        const state = JSON.parse(stateData);
        logger.info(`State loaded successfully from ${stateFilePath}.`);
        // Combine with default state to ensure all keys are present (optional)
        // return { ...defaultState, ...state }; 
        return state; 
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.info(`State file not found at ${stateFilePath}. Initializing with default state.`);
        } else if (err instanceof SyntaxError) {
            logger.error(`Error parsing state file at ${stateFilePath} (invalid JSON). Initializing with default state. Error: ${err.message}`);
        } else {
            logger.error(`Error loading state file from ${stateFilePath}. Initializing with default state. Error: ${err.message}`);
        }
        return { ...defaultState }; // Return a copy of the default state
    }
}

/**
 * Saves the synchronization state to the specified file.
 * @param {string} stateFilePath - The absolute path to the state file.
 * @param {object} state - The state object to save.
 * @param {winston.Logger} logger - The logger instance.
 * @returns {Promise<void>}
 * @throws {Error} If saving fails.
 */
async function saveState(stateFilePath, state, logger) {
    logger.debug(`Attempting to save state to: ${stateFilePath}`);
    try {
        const stateString = JSON.stringify(state, null, 2); // Pretty print JSON
        await fs.writeFile(stateFilePath, stateString, 'utf8');
        logger.info(`State saved successfully to ${stateFilePath}.`);
    } catch (err) {
        logger.error(`Error saving state file to ${stateFilePath}: ${err.message}`);
        // Re-throw the error so the main application knows saving failed
        throw new Error(`Failed to save state: ${err.message}`);
    }
}

module.exports = { loadState, saveState, defaultState }; 