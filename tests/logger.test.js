const { createLogger, logStartupInfo } = require('../src/logger');
const winston = require('winston');

// Mock winston and fs
jest.mock('winston');
jest.mock('fs');

describe('Logger Module', () => {
    let mockLogger;
    let mockTransports;
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock logger methods
        mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };
        
        // Mock winston transports
        mockTransports = {
            Console: jest.fn(),
            File: jest.fn()
        };
        
        winston.transports = mockTransports;
        winston.format = {
            combine: jest.fn(() => 'combined-format'),
            timestamp: jest.fn(() => 'timestamp-format'),
            errors: jest.fn(() => 'errors-format'),
            json: jest.fn(() => 'json-format'),
            colorize: jest.fn(() => 'colorize-format'),
            printf: jest.fn(() => 'printf-format')
        };
        winston.createLogger = jest.fn(() => mockLogger);
        
        // Mock fs
        const fs = require('fs');
        fs.mkdirSync = jest.fn();
        
        // Mock console methods
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('createLogger', () => {
        const mockConfig = {
            logFilePath: '/test/logs/app.log',
            logLevel: 'debug'
        };

        test('should create logger with correct configuration', () => {
            const logger = createLogger(mockConfig, false);

            expect(winston.createLogger).toHaveBeenCalledWith({
                level: 'debug',
                format: 'combined-format',
                transports: expect.any(Array),
                exceptionHandlers: expect.any(Array),
                rejectionHandlers: expect.any(Array)
            });
            
            expect(logger).toBe(mockLogger);
        });

        test('should use default log level when not specified', () => {
            const configWithoutLevel = { logFilePath: '/test/logs/app.log' };
            createLogger(configWithoutLevel, false);

            expect(winston.createLogger).toHaveBeenCalledWith(
                expect.objectContaining({ level: 'info' })
            );
        });

        test('should create log directory', () => {
            const fs = require('fs');
            createLogger(mockConfig, false);

            expect(fs.mkdirSync).toHaveBeenCalledWith('/test/logs', { recursive: true });
        });

        test('should handle directory creation error', () => {
            const fs = require('fs');
            const mockError = new Error('Permission denied');
            fs.mkdirSync.mockImplementation(() => {
                throw mockError;
            });

            createLogger(mockConfig, false);

            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to create log directory'),
                mockError
            );
        });

        test('should configure console transport', () => {
            createLogger(mockConfig, false);

            expect(mockTransports.Console).toHaveBeenCalledWith({
                level: 'info',
                format: 'combined-format'
            });
        });

        test('should configure file transports', () => {
            createLogger(mockConfig, false);

            expect(mockTransports.File).toHaveBeenCalledWith({
                filename: '/test/logs/app.log',
                level: 'info'
            });
            
            expect(mockTransports.File).toHaveBeenCalledWith({
                filename: '/test/logs/error.log',
                level: 'error'
            });
        });

        test('should configure exception and rejection handlers', () => {
            createLogger(mockConfig, false);

            // Check that exception and rejection handlers are configured
            const createLoggerCall = winston.createLogger.mock.calls[0][0];
            expect(createLoggerCall.exceptionHandlers).toBeDefined();
            expect(createLoggerCall.rejectionHandlers).toBeDefined();
            expect(createLoggerCall.exceptionHandlers).toHaveLength(1);
            expect(createLoggerCall.rejectionHandlers).toHaveLength(1);
        });

        test('should call winston format functions correctly', () => {
            createLogger(mockConfig, false);

            expect(winston.format.combine).toHaveBeenCalled();
            expect(winston.format.timestamp).toHaveBeenCalledWith({ format: 'YYYY-MM-DD HH:mm:ss' });
            expect(winston.format.errors).toHaveBeenCalledWith({ stack: true });
            expect(winston.format.json).toHaveBeenCalled();
            expect(winston.format.colorize).toHaveBeenCalled();
            expect(winston.format.printf).toHaveBeenCalled();
        });
    });

    describe('logStartupInfo', () => {
        const mockConfig = {
            logFilePath: '/test/logs/app.log',
            stateFilePath: '/test/data/state.json',
            statusFilePath: '/test/data/status.json',
            credentialsPath: '/test/config/creds.json',
            localSyncDirectory: '/test/sync',
            debugMaxPages: 5,
            debugMaxDownloads: 10
        };

        test('should log basic startup information', () => {
            logStartupInfo(mockLogger, mockConfig, '/test/config.json', '/test/lock.file', false);

            expect(mockLogger.info).toHaveBeenCalledWith("---------------------------------------------");
            expect(mockLogger.info).toHaveBeenCalledWith("Starting Google Photos Backup... (Mode: Development)");
            expect(mockLogger.info).toHaveBeenCalledWith("Using configuration file: /test/config.json");
            expect(mockLogger.info).toHaveBeenCalledWith("Log file: /test/logs/app.log");
            expect(mockLogger.info).toHaveBeenCalledWith("State file: /test/data/state.json");
            expect(mockLogger.info).toHaveBeenCalledWith("Status file: /test/data/status.json");
            expect(mockLogger.info).toHaveBeenCalledWith("Lock file: /test/lock.file");
            expect(mockLogger.info).toHaveBeenCalledWith("Credentials file: /test/config/creds.json");
            expect(mockLogger.info).toHaveBeenCalledWith("Local sync target: /test/sync");
        });

        test('should log production mode correctly', () => {
            logStartupInfo(mockLogger, mockConfig, '/test/config.json', '/test/lock.file', true);

            expect(mockLogger.info).toHaveBeenCalledWith("Starting Google Photos Backup... (Mode: Production)");
        });

        test('should log debug mode warnings when enabled', () => {
            logStartupInfo(mockLogger, mockConfig, '/test/config.json', '/test/lock.file', false);

            expect(mockLogger.warn).toHaveBeenCalledWith("*** Debug mode enabled: Max 5 pages will be fetched. ***");
            expect(mockLogger.warn).toHaveBeenCalledWith("*** Debug mode enabled: Max 10 downloads will be attempted. ***");
        });

        test('should not log debug warnings when debug values are 0', () => {
            const configWithoutDebug = {
                ...mockConfig,
                debugMaxPages: 0,
                debugMaxDownloads: 0
            };
            
            logStartupInfo(mockLogger, configWithoutDebug, '/test/config.json', '/test/lock.file', false);

            expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining("Debug mode enabled"));
        });

        test('should not log debug warnings when debug values are undefined', () => {
            const configWithoutDebug = { ...mockConfig };
            delete configWithoutDebug.debugMaxPages;
            delete configWithoutDebug.debugMaxDownloads;
            
            logStartupInfo(mockLogger, configWithoutDebug, '/test/config.json', '/test/lock.file', false);

            expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining("Debug mode enabled"));
        });

        test('should log partial debug warnings when only one debug option is set', () => {
            const configWithPartialDebug = {
                ...mockConfig,
                debugMaxPages: 3,
                debugMaxDownloads: 0
            };
            
            logStartupInfo(mockLogger, configWithPartialDebug, '/test/config.json', '/test/lock.file', false);

            expect(mockLogger.warn).toHaveBeenCalledWith("*** Debug mode enabled: Max 3 pages will be fetched. ***");
            expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining("downloads will be attempted"));
        });
    });
}); 