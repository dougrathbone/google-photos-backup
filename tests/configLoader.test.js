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
        stateFilePath: './state.json',
        debugMaxPages: 0,
        debugMaxDownloads: 0,
        continuousMode: false // Add default
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

    test('should load config successfully with valid optional debugMaxPages', () => {
        fs.existsSync.mockReturnValue(true);
        const configWithDebug = { ...baseConfigContent, debugMaxPages: 5 };
        fs.readFileSync.mockReturnValue(JSON.stringify(configWithDebug));

        const config = loadConfig(mockConfigPath);
        expect(config.debugMaxPages).toBe(5);
    });
    
    test('should default debugMaxPages to 0 if null or missing', () => {
        fs.existsSync.mockReturnValue(true);
        let configContent = { ...baseConfigContent };
        delete configContent.debugMaxPages; // Test missing
        fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
        let config = loadConfig(mockConfigPath);
        expect(config.debugMaxPages).toBe(0);

        configContent = { ...baseConfigContent, debugMaxPages: null }; // Test null
        fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
        config = loadConfig(mockConfigPath);
        expect(config.debugMaxPages).toBe(0);
    });

    test('should throw error if debugMaxPages is not a non-negative integer', () => {
        fs.existsSync.mockReturnValue(true);
        
        const invalidValues = [-1, 1.5, 'abc', {}];
        for (const invalidValue of invalidValues) {
             const configContent = { ...baseConfigContent, debugMaxPages: invalidValue };
             fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
             expect(() => {
                 loadConfig(mockConfigPath);
             }).toThrow('Invalid configuration: debugMaxPages must be a non-negative integer');
        }
    });

    test('should load config successfully with valid optional debugMaxDownloads', () => {
        fs.existsSync.mockReturnValue(true);
        const configWithDebug = { ...baseConfigContent, debugMaxDownloads: 10 };
        fs.readFileSync.mockReturnValue(JSON.stringify(configWithDebug));
        const config = loadConfig(mockConfigPath);
        expect(config.debugMaxDownloads).toBe(10);
    });
    
    test('should default debugMaxDownloads to 0 if null or missing', () => {
        fs.existsSync.mockReturnValue(true);
        let configContent = { ...baseConfigContent };
        delete configContent.debugMaxDownloads; // Test missing
        fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
        let config = loadConfig(mockConfigPath);
        expect(config.debugMaxDownloads).toBe(0);

        configContent = { ...baseConfigContent, debugMaxDownloads: null }; // Test null
        fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
        config = loadConfig(mockConfigPath);
        expect(config.debugMaxDownloads).toBe(0);
    });

    test('should throw error if debugMaxDownloads is not a non-negative integer', () => {
        fs.existsSync.mockReturnValue(true);
        const invalidValues = [-5, 2.5, 'many', {}];
        for (const invalidValue of invalidValues) {
             const configContent = { ...baseConfigContent, debugMaxDownloads: invalidValue };
             fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
             expect(() => {
                 loadConfig(mockConfigPath);
             }).toThrow('Invalid configuration: debugMaxDownloads must be a non-negative integer');
        }
    });

    test('should load config successfully with continuousMode true/false', () => {
        fs.existsSync.mockReturnValue(true);
        let configContent = { ...baseConfigContent, continuousMode: true };
        fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
        let config = loadConfig(mockConfigPath);
        expect(config.continuousMode).toBe(true);
        
        configContent = { ...baseConfigContent, continuousMode: false };
        fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
        config = loadConfig(mockConfigPath);
        expect(config.continuousMode).toBe(false);
    });
    
    test('should default continuousMode to false if null or missing', () => {
        fs.existsSync.mockReturnValue(true);
        let configContent = { ...baseConfigContent };
        delete configContent.continuousMode; // Test missing
        fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
        let config = loadConfig(mockConfigPath);
        expect(config.continuousMode).toBe(false);

        configContent = { ...baseConfigContent, continuousMode: null }; // Test null
        fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
        config = loadConfig(mockConfigPath);
        expect(config.continuousMode).toBe(false);
    });

    test('should throw error if continuousMode is not boolean', () => {
        fs.existsSync.mockReturnValue(true);
        const invalidValues = [0, 1, 'true', {}];
        for (const invalidValue of invalidValues) {
             const configContent = { ...baseConfigContent, continuousMode: invalidValue };
             fs.readFileSync.mockReturnValue(JSON.stringify(configContent));
             expect(() => {
                 loadConfig(mockConfigPath);
             }).toThrow('Invalid configuration: continuousMode must be true or false.');
        }
    });
}); 