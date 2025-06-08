const { initializeConfigAndPaths, APP_NAME } = require('../src/environment');
const { loadConfig } = require('../src/configLoader');

// Mock the configLoader module
jest.mock('../src/configLoader');

describe('Environment Module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset console methods
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('APP_NAME constant', () => {
        test('should export the correct app name', () => {
            expect(APP_NAME).toBe('google-photos-backup');
        });
    });

    describe('initializeConfigAndPaths', () => {
        const mockConfig = {
            credentialsPath: './client_credentials.json',
            localSyncDirectory: './gphotos_backup',
            stateFilePath: './sync_state.json',
            logFilePath: './gphotos_sync.log',
            statusFilePath: './status.json'
        };

        beforeEach(() => {
            loadConfig.mockReturnValue(mockConfig);
        });

        test('should initialize development environment correctly', () => {
            const result = initializeConfigAndPaths('development', '/test/dir/src');

            expect(result.isProduction).toBe(false);
            expect(result.baseConfigDir).toBe('/test/dir');
            expect(result.baseDataDir).toBe('/test/dir/data');
            expect(result.baseLogDir).toBe('/test/dir/logs');
            expect(result.configPath).toBe('/test/dir/config.json');
            expect(result.config).toBeDefined();
            expect(result.lockFilePath).toContain('google-photos-backup.lock');
        });

        test('should initialize production environment correctly', () => {
            const result = initializeConfigAndPaths('production', '/test/dir/src');

            expect(result.isProduction).toBe(true);
            expect(result.baseConfigDir).toBe('/etc/google-photos-backup');
            expect(result.baseDataDir).toBe('/var/lib/google-photos-backup');
            expect(result.baseLogDir).toBe('/var/log/google-photos-backup');
            expect(result.configPath).toBe('/etc/google-photos-backup/config.json');
            expect(result.config).toBeDefined();
            expect(result.lockFilePath).toContain('/var/lib/google-photos-backup/google-photos-backup.lock');
        });

        test('should resolve development paths correctly', () => {
            // Reset the mock to ensure clean state
            loadConfig.mockReturnValue(mockConfig);
            
            const result = initializeConfigAndPaths('development', '/test/dir/src');

            expect(result.config.credentialsPath).toBe('/test/dir/client_credentials.json');
            expect(result.config.localSyncDirectory).toBe('/test/dir/gphotos_backup');
            expect(result.config.stateFilePath).toBe('/test/dir/data/sync_state.json');
            expect(result.config.logFilePath).toBe('/test/dir/logs/gphotos_sync.log');
            expect(result.config.statusFilePath).toBe('/test/dir/data/status.json');
        });

        test('should override production paths correctly', () => {
            const result = initializeConfigAndPaths('production', '/test/dir/src');

            expect(result.config.credentialsPath).toBe('/etc/google-photos-backup/client_credentials.json');
            expect(result.config.stateFilePath).toBe('/var/lib/google-photos-backup/sync_state.json');
            expect(result.config.logFilePath).toBe('/var/log/google-photos-backup/gphotos_sync.log');
            expect(result.config.statusFilePath).toBe('/var/lib/google-photos-backup/status.json');
        });

        test('should handle missing localSyncDirectory in production', () => {
            const configWithoutSyncDir = { ...mockConfig };
            delete configWithoutSyncDir.localSyncDirectory;
            loadConfig.mockReturnValue(configWithoutSyncDir);

            const result = initializeConfigAndPaths('production', '/test/dir/src');

            expect(result.config.localSyncDirectory).toBe('/var/lib/google-photos-backup/gphotos_backup');
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('localSyncDirectory not set, defaulting to:')
            );
        });

        test('should throw error when config loading fails', () => {
            const mockError = new Error('Config file not found');
            loadConfig.mockImplementation(() => {
                throw mockError;
            });

            expect(() => {
                initializeConfigAndPaths('development', '/test/dir/src');
            }).toThrow('Configuration error from /test/dir/config.json: Config file not found');

            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to load/process configuration'),
                'Config file not found'
            );
        });

        test('should log startup messages correctly', () => {
            initializeConfigAndPaths('development', '/test/dir/src');

            expect(console.log).toHaveBeenCalledWith('Initializing config and paths (Mode: Development)');
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('Raw configuration loaded from:')
            );
            expect(console.log).toHaveBeenCalledWith('Resolving paths for DEVELOPMENT environment.');
        });

        test('should handle production mode logging', () => {
            initializeConfigAndPaths('production', '/test/dir/src');

            expect(console.log).toHaveBeenCalledWith('Initializing config and paths (Mode: Production)');
            expect(console.log).toHaveBeenCalledWith('Overriding configuration paths for PRODUCTION environment.');
        });

        test('should use fallback values for missing config properties', () => {
            const minimalConfig = {};
            loadConfig.mockReturnValue(minimalConfig);

            const result = initializeConfigAndPaths('production', '/test/dir/src');

            expect(result.config.credentialsPath).toBe('/etc/google-photos-backup/client_secret.json');
            expect(result.config.stateFilePath).toBe('/var/lib/google-photos-backup/sync_state.json');
            expect(result.config.logFilePath).toBe('/var/log/google-photos-backup/gphotos_sync.log');
            expect(result.config.statusFilePath).toBe('/var/lib/google-photos-backup/status.json');
        });
    });
}); 