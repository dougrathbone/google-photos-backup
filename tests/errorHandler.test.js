const { ErrorHandler, AppError, ErrorTypes, ErrorSeverity } = require('../src/errorHandler');

describe('Error Handler Module', () => {
    let mockLogger;
    let mockStatusUpdater;
    let errorHandler;

    beforeEach(() => {
        mockLogger = {
            error: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            debug: jest.fn()
        };

        mockStatusUpdater = {
            updateStatus: jest.fn().mockResolvedValue(true)
        };

        errorHandler = new ErrorHandler(mockLogger, mockStatusUpdater);

        // Mock process.exit to prevent actual exit during tests
        jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('ErrorTypes constant', () => {
        test('should export all expected error types', () => {
            expect(ErrorTypes.CONFIGURATION).toBe('configuration');
            expect(ErrorTypes.AUTHENTICATION).toBe('authentication');
            expect(ErrorTypes.NETWORK).toBe('network');
            expect(ErrorTypes.FILE_SYSTEM).toBe('file_system');
            expect(ErrorTypes.API).toBe('api');
            expect(ErrorTypes.LOCK).toBe('lock');
            expect(ErrorTypes.UNKNOWN).toBe('unknown');
        });
    });

    describe('ErrorSeverity constant', () => {
        test('should export all expected severity levels', () => {
            expect(ErrorSeverity.CRITICAL).toBe('critical');
            expect(ErrorSeverity.ERROR).toBe('error');
            expect(ErrorSeverity.WARNING).toBe('warning');
            expect(ErrorSeverity.INFO).toBe('info');
        });
    });

    describe('AppError class', () => {
        test('should create error with default values', () => {
            const error = new AppError('Test message');

            expect(error.message).toBe('Test message');
            expect(error.name).toBe('AppError');
            expect(error.type).toBe(ErrorTypes.UNKNOWN);
            expect(error.severity).toBe(ErrorSeverity.ERROR);
            expect(error.originalError).toBeNull();
            expect(error.timestamp).toBeDefined();
            expect(error.stack).toBeDefined();
        });

        test('should create error with custom values', () => {
            const originalError = new Error('Original');
            const error = new AppError(
                'Custom message',
                ErrorTypes.CONFIGURATION,
                ErrorSeverity.CRITICAL,
                originalError
            );

            expect(error.message).toBe('Custom message');
            expect(error.type).toBe(ErrorTypes.CONFIGURATION);
            expect(error.severity).toBe(ErrorSeverity.CRITICAL);
            expect(error.originalError).toBe(originalError);
        });

        test('should be instance of Error', () => {
            const error = new AppError('Test');
            expect(error instanceof Error).toBe(true);
            expect(error instanceof AppError).toBe(true);
        });
    });

    describe('ErrorHandler class', () => {
        describe('constructor', () => {
            test('should initialize with logger and statusUpdater', () => {
                expect(errorHandler.logger).toBe(mockLogger);
                expect(errorHandler.statusUpdater).toBe(mockStatusUpdater);
            });
        });

        describe('handleError', () => {
            test('should handle AppError with critical severity', async () => {
                const error = new AppError('Critical error', ErrorTypes.CONFIGURATION, ErrorSeverity.CRITICAL);
                
                const result = await errorHandler.handleError(error, 'Test Context');

                expect(result).toBe(true);
                expect(mockLogger.error).toHaveBeenCalledWith(
                    'CRITICAL ERROR in Test Context: Critical error',
                    expect.objectContaining({
                        message: 'Critical error',
                        type: ErrorTypes.CONFIGURATION,
                        severity: ErrorSeverity.CRITICAL,
                        context: 'Test Context'
                    })
                );
                expect(mockStatusUpdater.updateStatus).toHaveBeenCalledWith({
                    status: 'failed',
                    lastRunError: 'Critical error',
                    lastRunFinish: expect.any(String)
                }, mockLogger);
            });

            test('should handle regular Error with default severity', async () => {
                const error = new Error('Regular error');
                
                await errorHandler.handleError(error, 'Test Context');

                expect(mockLogger.error).toHaveBeenCalledWith(
                    'ERROR in Test Context: Regular error',
                    expect.objectContaining({
                        message: 'Regular error',
                        type: ErrorTypes.UNKNOWN,
                        severity: ErrorSeverity.ERROR
                    })
                );
            });

            test('should handle warning severity', async () => {
                const error = new AppError('Warning message', ErrorTypes.LOCK, ErrorSeverity.WARNING);
                
                await errorHandler.handleError(error, 'Test Context');

                expect(mockLogger.warn).toHaveBeenCalledWith(
                    'WARNING in Test Context: Warning message',
                    expect.any(Object)
                );
            });

            test('should handle info severity', async () => {
                const error = new AppError('Info message', ErrorTypes.UNKNOWN, ErrorSeverity.INFO);
                
                await errorHandler.handleError(error, 'Test Context');

                expect(mockLogger.info).toHaveBeenCalledWith(
                    'INFO in Test Context: Info message',
                    expect.any(Object)
                );
                // Should not update status for info level
                expect(mockStatusUpdater.updateStatus).not.toHaveBeenCalled();
            });

            test('should exit process when shouldExit is true and severity is critical', async () => {
                const error = new AppError('Critical error', ErrorTypes.CONFIGURATION, ErrorSeverity.CRITICAL);
                
                await errorHandler.handleError(error, 'Test Context', true);

                expect(process.exit).toHaveBeenCalledWith(1);
            });

            test('should not exit process when shouldExit is true but severity is not critical', async () => {
                const error = new AppError('Error message', ErrorTypes.UNKNOWN, ErrorSeverity.ERROR);
                
                await errorHandler.handleError(error, 'Test Context', true);

                expect(process.exit).not.toHaveBeenCalled();
            });

            test('should handle status update failure gracefully', async () => {
                mockStatusUpdater.updateStatus.mockRejectedValue(new Error('Status update failed'));
                const error = new AppError('Test error');
                
                await errorHandler.handleError(error, 'Test Context');

                expect(mockLogger.error).toHaveBeenCalledWith(
                    'Failed to update status after error:',
                    expect.any(Error)
                );
            });

            test('should use default context when none provided', async () => {
                const error = new Error('Test error');
                
                await errorHandler.handleError(error);

                expect(mockLogger.error).toHaveBeenCalledWith(
                    'ERROR in Unknown: Test error',
                    expect.any(Object)
                );
            });
        });

        describe('error creation methods', () => {
            test('createConfigurationError should create correct error', () => {
                const originalError = new Error('Original');
                const error = errorHandler.createConfigurationError('Config error', originalError);

                expect(error).toBeInstanceOf(AppError);
                expect(error.message).toBe('Config error');
                expect(error.type).toBe(ErrorTypes.CONFIGURATION);
                expect(error.severity).toBe(ErrorSeverity.CRITICAL);
                expect(error.originalError).toBe(originalError);
            });

            test('createAuthenticationError should create correct error', () => {
                const error = errorHandler.createAuthenticationError('Auth error');

                expect(error.type).toBe(ErrorTypes.AUTHENTICATION);
                expect(error.severity).toBe(ErrorSeverity.CRITICAL);
            });

            test('createNetworkError should create correct error', () => {
                const error = errorHandler.createNetworkError('Network error');

                expect(error.type).toBe(ErrorTypes.NETWORK);
                expect(error.severity).toBe(ErrorSeverity.ERROR);
            });

            test('createFileSystemError should create correct error', () => {
                const error = errorHandler.createFileSystemError('FS error');

                expect(error.type).toBe(ErrorTypes.FILE_SYSTEM);
                expect(error.severity).toBe(ErrorSeverity.ERROR);
            });

            test('createApiError should create correct error', () => {
                const error = errorHandler.createApiError('API error');

                expect(error.type).toBe(ErrorTypes.API);
                expect(error.severity).toBe(ErrorSeverity.ERROR);
            });

            test('createLockError should create correct error', () => {
                const error = errorHandler.createLockError('Lock error');

                expect(error.type).toBe(ErrorTypes.LOCK);
                expect(error.severity).toBe(ErrorSeverity.WARNING);
            });
        });

        describe('wrapFunction', () => {
            test('should wrap function and handle errors', async () => {
                const mockFn = jest.fn().mockRejectedValue(new Error('Function error'));
                const wrappedFn = errorHandler.wrapFunction(mockFn, 'Wrapped Function');

                await expect(wrappedFn('arg1', 'arg2')).rejects.toThrow('Function error');

                expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
                expect(mockLogger.error).toHaveBeenCalledWith(
                    'ERROR in Wrapped Function: Function error',
                    expect.any(Object)
                );
            });

            test('should wrap function and return result on success', async () => {
                const mockFn = jest.fn().mockResolvedValue('success');
                const wrappedFn = errorHandler.wrapFunction(mockFn, 'Wrapped Function');

                const result = await wrappedFn('arg1');

                expect(result).toBe('success');
                expect(mockFn).toHaveBeenCalledWith('arg1');
                expect(mockLogger.error).not.toHaveBeenCalled();
            });

            test('should handle synchronous functions', async () => {
                const mockFn = jest.fn(() => {
                    throw new Error('Sync error');
                });
                const wrappedFn = errorHandler.wrapFunction(mockFn, 'Sync Function');

                await expect(wrappedFn()).rejects.toThrow('Sync error');
                expect(mockLogger.error).toHaveBeenCalled();
            });
        });
    });
}); 