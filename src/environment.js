const path = require('path');
const { loadConfig } = require('./configLoader');

const APP_NAME = 'google-photos-backup'; // Consistent naming

/**
 * Determines environment, resolves base paths, loads configuration,
 * and overrides/resolves paths within the config object.
 *
 * @param {string} nodeEnv - The value of process.env.NODE_ENV.
 * @param {string} scriptDirname - The value of __dirname from the calling script.
 * @returns {object} An object containing: { config, baseConfigDir, baseDataDir, baseLogDir, configPath, lockFilePath, isProduction }
 * @throws {Error} If configuration loading fails.
 */
function initializeConfigAndPaths(nodeEnv, scriptDirname) {
    const isProduction = nodeEnv === 'production';
    console.log(`Initializing config and paths (Mode: ${isProduction ? 'Production' : 'Development'})`);

    let baseConfigDir, baseDataDir, baseLogDir;

    if (isProduction) {
        baseConfigDir = '/etc/' + APP_NAME;
        baseDataDir = '/var/lib/' + APP_NAME;
        baseLogDir = '/var/log/' + APP_NAME;
    } else {
        const projectRoot = path.resolve(scriptDirname, '..');
        baseConfigDir = projectRoot;
        baseDataDir = path.join(projectRoot, 'data');
        baseLogDir = path.join(projectRoot, 'logs');
    }

    const configPath = isProduction
        ? path.join(baseConfigDir, 'config.json')
        : path.resolve(scriptDirname, '../config.json');

    let config;
    try {
        config = { ...loadConfig(configPath) }; // Create a copy to avoid mutations
        console.log(`Raw configuration loaded from: ${configPath}`);

        if (isProduction) {
            console.log("Overriding configuration paths for PRODUCTION environment.");
            config.credentialsPath = path.join(baseConfigDir, path.basename(config.credentialsPath || 'client_secret.json'));
            config.stateFilePath = path.join(baseDataDir, path.basename(config.stateFilePath || 'sync_state.json'));
            config.logFilePath = path.join(baseLogDir, path.basename(config.logFilePath || 'gphotos_sync.log'));
            config.statusFilePath = path.join(baseDataDir, path.basename(config.statusFilePath || 'status.json'));
            if (!config.localSyncDirectory) {
                 config.localSyncDirectory = path.join(baseDataDir, 'gphotos_backup');
                 console.log(`localSyncDirectory not set, defaulting to: ${config.localSyncDirectory}`);
            }
        } else {
            console.log("Resolving paths for DEVELOPMENT environment.");
            config.credentialsPath = path.resolve(baseConfigDir, config.credentialsPath);
            config.stateFilePath = path.resolve(baseDataDir, path.basename(config.stateFilePath || 'sync_state.json'));
            config.logFilePath = path.resolve(baseLogDir, path.basename(config.logFilePath || 'gphotos_sync.log'));
            config.statusFilePath = path.resolve(baseDataDir, path.basename(config.statusFilePath || 'status.json'));
            config.localSyncDirectory = path.resolve(baseConfigDir, config.localSyncDirectory);
            console.log("Resolved development paths:", JSON.stringify(config, null, 2));
        }
    } catch (error) {
        console.error(`Failed to load/process configuration from ${configPath}:`, error.message);
        // Re-throw the error to be handled by the caller
        throw new Error(`Configuration error from ${configPath}: ${error.message}`);
    }

    // Define lock file path based on environment
    const lockFileName = 'google-photos-backup.lock';
    const lockFilePath = isProduction
        ? path.join(baseDataDir, lockFileName)
        : path.join(path.dirname(config.stateFilePath), lockFileName); // Near state file for dev

    return { config, baseConfigDir, baseDataDir, baseLogDir, configPath, lockFilePath, isProduction };
}

module.exports = {
    initializeConfigAndPaths,
    APP_NAME
}; 