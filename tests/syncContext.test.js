const { SyncContext } = require('../src/syncContext');

describe('SyncContext', () => {
    let mockConfig;
    let mockLogger;
    let mockErrorHandler;
    let mockStatusUpdater;
    let syncContext;

    beforeEach(() => {
        mockConfig = {
            credentialsPath: '/test/creds.json',
            localSyncDirectory: '/test/sync',
            stateFilePath: '/test/state.json'
        };

        mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };

        mockErrorHandler = {
            createAuthenticationError: jest.fn((msg) => new Error(msg)),
            createConfigurationError: jest.fn((msg) => new Error(msg))
        };

        mockStatusUpdater = {
            updateStatus: jest.fn().mockResolvedValue(true)
        };

        syncContext = new SyncContext(mockConfig, mockLogger, mockErrorHandler, mockStatusUpdater);
    });

    describe('constructor', () => {
        test('should initialize with all required dependencies', () => {
            expect(syncContext.config).toBe(mockConfig);
            expect(syncContext.logger).toBe(mockLogger);
            expect(syncContext.errorHandler).toBe(mockErrorHandler);
            expect(syncContext.statusUpdater).toBe(mockStatusUpdater);
        });

        test('should set default values for optional properties', () => {
            expect(syncContext.lockFilePath).toBeNull();
            expect(syncContext.releaseLock).toBeNull();
            expect(syncContext.authResult).toBeNull();
            expect(syncContext.currentState).toBeNull();
            expect(syncContext.syncStartTime).toBeNull();
        });

        test('should set isProduction based on NODE_ENV', () => {
            const originalEnv = process.env.NODE_ENV;
            
            process.env.NODE_ENV = 'production';
            const prodContext = new SyncContext(mockConfig, mockLogger, mockErrorHandler, mockStatusUpdater);
            expect(prodContext.isProduction).toBe(true);
            
            process.env.NODE_ENV = 'development';
            const devContext = new SyncContext(mockConfig, mockLogger, mockErrorHandler, mockStatusUpdater);
            expect(devContext.isProduction).toBe(false);
            
            process.env.NODE_ENV = originalEnv; // Restore
        });

        test('should throw error if required dependencies are missing', () => {
            expect(() => {
                new SyncContext(null, mockLogger, mockErrorHandler, mockStatusUpdater);
            }).toThrow('SyncContext missing required dependencies: config');

            expect(() => {
                new SyncContext(mockConfig, null, mockErrorHandler, mockStatusUpdater);
            }).toThrow('SyncContext missing required dependencies: logger');

            expect(() => {
                new SyncContext(mockConfig, mockLogger, null, mockStatusUpdater);
            }).toThrow('SyncContext missing required dependencies: errorHandler');

            // statusUpdater is now optional, so this should not throw
            expect(() => {
                new SyncContext(mockConfig, mockLogger, mockErrorHandler, null);
            }).not.toThrow();
        });
    });

    describe('setLockInfo', () => {
        test('should set lock file path and release function', () => {
            const mockReleaseFn = jest.fn();
            const lockPath = '/test/lock';

            syncContext.setLockInfo(lockPath, mockReleaseFn);

            expect(syncContext.lockFilePath).toBe(lockPath);
            expect(syncContext.releaseLock).toBe(mockReleaseFn);
        });
    });

    describe('setAuthResult', () => {
        test('should set authentication result', () => {
            const authResult = {
                accessToken: 'test-token',
                client: { id: 'test-client' }
            };

            syncContext.setAuthResult(authResult);

            expect(syncContext.authResult).toBe(authResult);
        });
    });

    describe('setCurrentState', () => {
        test('should set current state', () => {
            const state = { lastSyncTimestamp: '2024-01-01T00:00:00Z' };

            syncContext.setCurrentState(state);

            expect(syncContext.currentState).toBe(state);
        });
    });

    describe('getAccessToken', () => {
        test('should return access token when auth result exists', () => {
            syncContext.setAuthResult({ accessToken: 'test-token' });

            expect(syncContext.getAccessToken()).toBe('test-token');
        });

        test('should return null when auth result does not exist', () => {
            expect(syncContext.getAccessToken()).toBeNull();
        });

        test('should return null when auth result exists but no access token', () => {
            syncContext.setAuthResult({ client: 'test-client' });

            expect(syncContext.getAccessToken()).toBeNull();
        });
    });

    describe('getAuthClient', () => {
        test('should return auth client when auth result exists', () => {
            const client = { id: 'test-client' };
            syncContext.setAuthResult({ client: client });

            expect(syncContext.getAuthClient()).toBe(client);
        });

        test('should return null when auth result does not exist', () => {
            expect(syncContext.getAuthClient()).toBeNull();
        });
    });

    describe('getLastSyncTimestamp', () => {
        test('should return timestamp when state exists', () => {
            syncContext.setCurrentState({ lastSyncTimestamp: '2024-01-01T00:00:00Z' });

            expect(syncContext.getLastSyncTimestamp()).toBe('2024-01-01T00:00:00Z');
        });

        test('should return null when state does not exist', () => {
            expect(syncContext.getLastSyncTimestamp()).toBeNull();
        });

        test('should return null when state exists but no timestamp', () => {
            syncContext.setCurrentState({ otherProperty: 'value' });

            expect(syncContext.getLastSyncTimestamp()).toBeNull();
        });
    });

    describe('updateLastSyncTimestamp', () => {
        test('should update timestamp in existing state', () => {
            syncContext.setCurrentState({ existingProperty: 'value' });
            
            syncContext.updateLastSyncTimestamp('2024-01-01T00:00:00Z');

            expect(syncContext.currentState.lastSyncTimestamp).toBe('2024-01-01T00:00:00Z');
            expect(syncContext.currentState.existingProperty).toBe('value');
        });

        test('should create state object if it does not exist', () => {
            syncContext.updateLastSyncTimestamp('2024-01-01T00:00:00Z');

            expect(syncContext.currentState).toEqual({
                lastSyncTimestamp: '2024-01-01T00:00:00Z'
            });
        });
    });

    describe('releaseLockSafely', () => {
        test('should release lock successfully', async () => {
            const mockReleaseFn = jest.fn().mockResolvedValue(true);
            syncContext.setLockInfo('/test/lock', mockReleaseFn);

            const result = await syncContext.releaseLockSafely();

            expect(result).toBe(true);
            expect(mockReleaseFn).toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith('Lock released successfully');
        });

        test('should handle lock release failure gracefully', async () => {
            const mockReleaseFn = jest.fn().mockRejectedValue(new Error('Release failed'));
            syncContext.setLockInfo('/test/lock', mockReleaseFn);

            const result = await syncContext.releaseLockSafely();

            expect(result).toBe(false);
            expect(mockLogger.warn).toHaveBeenCalledWith('Failed to release lock:', 'Release failed');
        });

        test('should return true when no lock to release', async () => {
            const result = await syncContext.releaseLockSafely();

            expect(result).toBe(true);
            expect(mockLogger.debug).toHaveBeenCalledWith('No lock to release');
        });
    });

    describe('requireAuth', () => {
        test('should not throw when authentication is available', () => {
            syncContext.setAuthResult({ accessToken: 'test-token' });

            expect(() => syncContext.requireAuth()).not.toThrow();
        });

        test('should throw when no auth result', () => {
            expect(() => syncContext.requireAuth()).toThrow();
            expect(mockErrorHandler.createAuthenticationError).toHaveBeenCalledWith(
                'Authentication required but not available'
            );
        });

        test('should throw when auth result exists but no access token', () => {
            syncContext.setAuthResult({ client: 'test-client' });

            expect(() => syncContext.requireAuth()).toThrow();
        });
    });

    describe('requireState', () => {
        test('should not throw when state is available', () => {
            syncContext.setCurrentState({ lastSyncTimestamp: '2024-01-01T00:00:00Z' });

            expect(() => syncContext.requireState()).not.toThrow();
        });

        test('should throw when no state is loaded', () => {
            expect(() => syncContext.requireState()).toThrow();
            expect(mockErrorHandler.createConfigurationError).toHaveBeenCalledWith(
                'State required but not loaded'
            );
        });
    });

    describe('validateDependencies', () => {
        test('should not throw when all dependencies are present', () => {
            expect(() => syncContext.validateDependencies()).not.toThrow();
        });

        test('should identify multiple missing dependencies', () => {
            syncContext.config = null;
            syncContext.logger = null;

            expect(() => syncContext.validateDependencies()).toThrow(
                'SyncContext missing required dependencies: config, logger'
            );
        });
    });
}); 