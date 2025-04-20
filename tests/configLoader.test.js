const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/configLoader');

// Mock the fs module
jest.mock('fs');

// Mock console logging to avoid cluttering test output
global.console = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
};

describe('Config Loader', () => {
    const mockConfigPath = '/fake/path/config.json';
    const mockConfigDir = '/fake/path';
    const baseConfigContent = {
        localSyncDirectory: './backup',
        syncIntervalHours: 1,
        credentialsPath: './creds.json',
        logFilePath: './app.log',
        stateFilePath: './state.json'
    };

    beforeEach(() => {
        // Reset mocks before each test
        fs.existsSync.mockReset();
        fs.readFileSync.mockReset();
        jest.clearAllMocks(); // Clear console mocks too
    });

    test('should load config successfully with valid JSON', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify(baseConfigContent));

        const config = loadConfig(mockConfigPath);

        expect(fs.existsSync).toHaveBeenCalledWith(mockConfigPath);
        expect(fs.readFileSync).toHaveBeenCalledWith(mockConfigPath, 'utf8');
        expect(config).toBeDefined();
        expect(config.syncIntervalHours).toBe(1);
        // Check if paths were resolved correctly
        expect(config.localSyncDirectory).toBe(path.resolve(mockConfigDir, './backup'));
        expect(config.credentialsPath).toBe(path.resolve(mockConfigDir, './creds.json'));
        expect(config.logFilePath).toBe(path.resolve(mockConfigDir, './app.log'));
        expect(config.stateFilePath).toBe(path.resolve(mockConfigDir, './state.json'));
        expect(console.log).toHaveBeenCalledWith(`Attempting to load configuration from: ${mockConfigPath}`);
        expect(console.log).toHaveBeenCalledWith("Configuration loaded successfully.");
    });

    test('should throw error if config file does not exist', () => {
        fs.existsSync.mockReturnValue(false);

        expect(() => {
            loadConfig(mockConfigPath);
        }).toThrow(`Configuration file not found at ${mockConfigPath}`);
        expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    test('should throw error if config file is unreadable', () => {
        fs.existsSync.mockReturnValue(true);
        const readError = new Error('Permission denied');
        fs.readFileSync.mockImplementation(() => {
            throw readError;
        });

        expect(() => {
            loadConfig(mockConfigPath);
        }).toThrow(`Error reading configuration file at ${mockConfigPath}: ${readError.message}`);
    });

    test('should throw error if config file is invalid JSON', () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('{\"key": "value",,}'); // Invalid JSON

        expect(() => {
            loadConfig(mockConfigPath);
        }).toThrow(/Error parsing configuration file/);
    });

    test('should throw error if required keys are missing', () => {
        fs.existsSync.mockReturnValue(true);
        const incompleteConfig = { ...baseConfigContent };
        delete incompleteConfig.logFilePath; // Remove a required key
        fs.readFileSync.mockReturnValue(JSON.stringify(incompleteConfig));

        expect(() => {
            loadConfig(mockConfigPath);
        }).toThrow('Missing required configuration keys: logFilePath');
    });
}); 