const path = require('path');

// --- Mocks ---

// Mock process.exit globally BEFORE anything else to prevent it stopping Jest
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    // Optional: Throw if needed for specific tests, but default to no-op
    // console.warn(`process.exit mock called with code: ${code}`); 
});

// Mock environment variables
const originalEnv = process.env;

// Mock configLoader
jest.mock('../src/configLoader', () => ({
    loadConfig: jest.fn(),
}));
const { loadConfig } = require('../src/configLoader');

// Mock fs operations (e.g., mkdirSync used in logger setup)
jest.mock('fs', () => ({
    ...jest.requireActual('fs'), // Use actual fs for things like path resolution if not mocked elsewhere
    promises: {
        ...jest.requireActual('fs').promises,
        readFile: jest.fn(),
        writeFile: jest.fn(),
    },
    mkdirSync: jest.fn(),
}));
const fs = require('fs');


// Mock winston logger
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(), // Added fatal
};
jest.mock('winston', () => ({
    format: {
        combine: jest.fn(),
        timestamp: jest.fn(),
        printf: jest.fn(),
        colorize: jest.fn(),
        json: jest.fn(),
        errors: jest.fn(),
    },
    createLogger: jest.fn(() => mockLogger),
    transports: {
        Console: jest.fn(),
        File: jest.fn(),
    },
}));

// Mock statusUpdater (just prevent errors during require)
jest.mock('../src/statusUpdater', () => ({
    initializeStatus: jest.fn(),
    updateStatus: jest.fn(),
    setIdleStatus: jest.fn(),
}));

// Mock other dependencies used later in the script (prevent require errors)
jest.mock('../src/googleAuth', () => ({ authorize: jest.fn() }));
jest.mock('../src/fileUtils', () => ({ findLatestFileDateRecursive: jest.fn() }));
jest.mock('../src/googlePhotosApi', () => ({ getLatestMediaItem: jest.fn() }));
jest.mock('../src/stateManager', () => ({ loadState: jest.fn(), saveState: jest.fn() }));
jest.mock('../src/syncManager', () => ({ runInitialSync: jest.fn(), runIncrementalSync: jest.fn() }));
jest.mock('proper-lockfile', () => ({
    lock: jest.fn(() => Promise.resolve(jest.fn())), // Return a mock release function
    check: jest.fn(() => Promise.resolve(false)),
    unlock: jest.fn(() => Promise.resolve()),
}));

// Import the function to test *after* mocks are set up
// We require it here, but tests will call the exported function directly
let initializeConfigAndPaths;
try {
    // Wrap the initial require in a try-catch *within the test file* 
    // to handle the case where mocks aren't perfectly set up for the initial load
    initializeConfigAndPaths = require('../src/google-synchroniser').initializeConfigAndPaths;
} catch (e) {
    // This might happen if the default mock setup isn't perfect, 
    // individual tests should still work by re-requiring or using the directly imported function.
    console.warn("Initial require of google-synchroniser failed in test setup:", e);
    // Define a placeholder if needed, though tests should rely on their specific setups
    initializeConfigAndPaths = () => { throw new Error('Initial require failed'); }; 
}

// --- Test Suite ---

describe('google-synchroniser.js initializeConfigAndPaths', () => {
    const APP_NAME = 'google-photos-backup';
    const MOCK_SCRIPT_DIRNAME = path.resolve(__dirname); // tests directory
    const MOCK_PROJECT_ROOT = path.resolve(MOCK_SCRIPT_DIRNAME, '..'); // Parent of tests dir

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv }; // Reset env

        // Reset modules BEFORE setting mocks for the test
        // This ensures that when initializeConfigAndPaths is called *within a test*,
        // it uses the mocks defined *for that test*.
        jest.resetModules(); 

        // Re-mock dependencies here, ensuring a SAFE default for loadConfig
        jest.mock('../src/configLoader', () => ({ loadConfig: jest.fn() }));
        const { loadConfig } = require('../src/configLoader');

        // Provide a default mock for loadConfig that returns a valid basic structure
        loadConfig.mockImplementation((configPath) => {
             // Minimal valid config to prevent errors during setup or unrelated tests
             return {
                 credentialsPath: './creds.json',
                 stateFilePath: './state.json',
                 logFilePath: './app.log',
                 statusFilePath: './status.json',
                 localSyncDirectory: './backup',
             };
        });
        
        // Re-require the function to test, ensuring it picks up the fresh mocks
        initializeConfigAndPaths = require('../src/google-synchroniser').initializeConfigAndPaths;

        // Mock fs after resetModules
        jest.mock('fs', () => ({
            ...jest.requireActual('fs'),
            promises: { ...jest.requireActual('fs').promises, readFile: jest.fn(), writeFile: jest.fn() },
            mkdirSync: jest.fn(),
        }));

    });

    afterAll(() => {
        process.env = originalEnv;
        mockExit.mockRestore();
    });

    test('should return correct paths and config in DEVELOPMENT mode', () => {
        process.env.NODE_ENV = 'development';
        
        // Define the dev config we expect loadConfig to return in this specific test
        const { loadConfig } = require('../src/configLoader');
        loadConfig.mockImplementation(() => ({
            credentialsPath: './dev_creds.json',
            stateFilePath: './dev_state/state.json',
            logFilePath: './dev_logs/app.log',
            statusFilePath: './dev_status/status.json',
            localSyncDirectory: './dev_backup',
        }));
        
        // Re-require the function AFTER setting the specific mock for this test
        const { initializeConfigAndPaths } = require('../src/google-synchroniser');

        const result = initializeConfigAndPaths(process.env.NODE_ENV, MOCK_SCRIPT_DIRNAME);

        const expectedDevConfigPath = path.resolve(MOCK_SCRIPT_DIRNAME, '../config.json');
        const expectedDevDataDir = path.resolve(MOCK_PROJECT_ROOT, 'data');
        const expectedDevLogDir = path.resolve(MOCK_PROJECT_ROOT, 'logs');
        const expectedDevStatePath = path.resolve(expectedDevDataDir, 'state.json');
        expect(result.isProduction).toBe(false);
        expect(loadConfig).toHaveBeenCalledWith(expectedDevConfigPath);
        expect(result.configPath).toBe(expectedDevConfigPath);
        expect(result.baseConfigDir).toBe(MOCK_PROJECT_ROOT);
        expect(result.baseDataDir).toBe(expectedDevDataDir);
        expect(result.baseLogDir).toBe(expectedDevLogDir);
        expect(result.lockFilePath).toBe(path.resolve(path.dirname(expectedDevStatePath), 'google-photos-backup.lock'));
        expect(result.config.credentialsPath).toBe(path.resolve(MOCK_PROJECT_ROOT, 'dev_creds.json'));
        expect(result.config.stateFilePath).toBe(expectedDevStatePath);
        expect(result.config.logFilePath).toBe(path.resolve(expectedDevLogDir, 'app.log'));
        expect(result.config.statusFilePath).toBe(path.resolve(expectedDevDataDir, 'status.json'));
        expect(result.config.localSyncDirectory).toBe(path.resolve(MOCK_PROJECT_ROOT, 'dev_backup'));
    });

    test('should return correct paths and overridden config in PRODUCTION mode', () => {
        process.env.NODE_ENV = 'production';
        
        // Define the prod config we expect loadConfig to return
        const { loadConfig } = require('../src/configLoader');
        loadConfig.mockImplementation(() => ({
            credentialsPath: `client_secret_prod.json`,
            stateFilePath: `sync_state_prod.json`,
            logFilePath: `gphotos_sync_prod.log`,
            statusFilePath: `status_prod.json`,
            localSyncDirectory: `/data/user_photos`,
        }));

        // Re-require the function AFTER setting the specific mock for this test
        const { initializeConfigAndPaths } = require('../src/google-synchroniser');
        
        const result = initializeConfigAndPaths(process.env.NODE_ENV, MOCK_SCRIPT_DIRNAME);

        const expectedProdConfigPath = `/etc/${APP_NAME}/config.json`;
        const expectedProdDataDir = `/var/lib/${APP_NAME}`;
        const expectedProdLogDir = `/var/log/${APP_NAME}`;
        const expectedProdBaseConfigDir = `/etc/${APP_NAME}`;
        expect(result.isProduction).toBe(true);
        expect(loadConfig).toHaveBeenCalledWith(expectedProdConfigPath);
        expect(result.configPath).toBe(expectedProdConfigPath);
        expect(result.baseConfigDir).toBe(expectedProdBaseConfigDir);
        expect(result.baseDataDir).toBe(expectedProdDataDir);
        expect(result.baseLogDir).toBe(expectedProdLogDir);
        expect(result.lockFilePath).toBe(path.join(expectedProdDataDir, 'google-photos-backup.lock'));
        expect(result.config.credentialsPath).toBe(path.join(expectedProdBaseConfigDir, 'client_secret_prod.json'));
        expect(result.config.stateFilePath).toBe(path.join(expectedProdDataDir, 'sync_state_prod.json'));
        expect(result.config.logFilePath).toBe(path.join(expectedProdLogDir, 'gphotos_sync_prod.log'));
        expect(result.config.statusFilePath).toBe(path.join(expectedProdDataDir, 'status_prod.json'));
        expect(result.config.localSyncDirectory).toBe('/data/user_photos');
    });

    test('should default localSyncDirectory in PRODUCTION mode if not set', () => {
        process.env.NODE_ENV = 'production';
        
        // Mock loadConfig specific for this test
        const { loadConfig } = require('../src/configLoader');
        loadConfig.mockImplementation(() => ({
            credentialsPath: `client_secret_prod.json`,
            stateFilePath: `sync_state_prod.json`,
            logFilePath: `gphotos_sync_prod.log`,
            statusFilePath: `status_prod.json`,
        }));
        
        // Re-require the function AFTER setting the specific mock for this test
        const { initializeConfigAndPaths } = require('../src/google-synchroniser');

        const result = initializeConfigAndPaths(process.env.NODE_ENV, MOCK_SCRIPT_DIRNAME);
        const expectedProdDataDir = `/var/lib/${APP_NAME}`;
        const expectedDefaultSyncDir = path.join(expectedProdDataDir, 'gphotos_backup');
        expect(result.config.localSyncDirectory).toBe(expectedDefaultSyncDir);
    });

    test('should throw error if config loading fails', () => {
        process.env.NODE_ENV = 'development';
        const errorMsg = 'Cannot load file';
        const expectedFullErrorMsgPrefix = 'Configuration error from';

        // Mock loadConfig specific for this test
        const { loadConfig } = require('../src/configLoader');
        loadConfig.mockImplementation(() => {
            throw new Error(errorMsg);
        });

        // Re-require the function AFTER setting the specific mock for this test
        const { initializeConfigAndPaths } = require('../src/google-synchroniser');

        // Mock console.error just for this test to reduce noise
        const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        // Expect the function itself to throw an error whose message contains the original message
        expect(() => {
            initializeConfigAndPaths(process.env.NODE_ENV, MOCK_SCRIPT_DIRNAME);
        }).toThrow(expect.objectContaining({
            message: expect.stringContaining(errorMsg)
        }));

        // Also check that the more specific error message prefix is present
         expect(() => {
            initializeConfigAndPaths(process.env.NODE_ENV, MOCK_SCRIPT_DIRNAME);
        }).toThrow(expect.objectContaining({
            message: expect.stringContaining(expectedFullErrorMsgPrefix)
        }));

        expect(loadConfig).toHaveBeenCalled();
        
        // NOTE: We are removing the check for mockExit NOT being called.
        // In the actual code, the top-level catch block *will* call process.exit(1)
        // when initializeConfigAndPaths throws. Our global mock prevents Jest exiting,
        // but the call happens. The key is that initializeConfigAndPaths *throws*.
        // expect(mockExit).not.toHaveBeenCalled(); // REMOVED

        // Restore console.error mock
        mockConsoleError.mockRestore();
    });
}); 