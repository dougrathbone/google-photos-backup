const fs = require('fs').promises;
const path = require('path');
const statusUpdater = require('../src/statusUpdater');

// Mock fs *before* requiring statusUpdater (which requires fs.promises)
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        // Add other promises if needed by statusUpdater directly
    },
     // Keep non-promise mocks if needed by other tests
    existsSync: jest.requireActual('fs').existsSync,
    readFileSync: jest.requireActual('fs').readFileSync,
     // Mock createWriteStream if downloader tests run with this
    createWriteStream: jest.fn(() => ({ on: jest.fn(), close: jest.fn() })), 
}));

// Get references to the mocked promise functions *after* mocking
const mockReadFile = fs.readFile;
const mockWriteFile = fs.writeFile;

// Mock logger
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

const mockDataDir = '/fake/data/dir';
// Use exported constant for filename
const expectedStatusFilename = statusUpdater._getStatusFilename();
const expectedStatusPath = path.join(mockDataDir, expectedStatusFilename);
const originalPid = process.pid;

// Use exported reset function
const resetStatusModule = statusUpdater._resetStatusModule;

describe('Status Updater', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetStatusModule(); // Use exported reset
        Object.defineProperty(process, 'pid', { value: 12345, writable: true });
        // Reset mocks using the direct references
        mockReadFile.mockReset();
        mockWriteFile.mockReset();
    });

    afterEach(() => {
        Object.defineProperty(process, 'pid', { value: originalPid });
    });

    describe('initializeStatus', () => {
        test('should reject invalid path', async () => {
            await statusUpdater.initializeStatus(null, mockLogger);
            expect(mockLogger.error).toHaveBeenCalledWith('Invalid status file path provided to StatusUpdater.');
            expect(statusUpdater._getStatusFilePath()).toBeNull();

            await statusUpdater.initializeStatus(undefined, mockLogger);
            expect(mockLogger.error).toHaveBeenCalledTimes(2);

            await statusUpdater.initializeStatus('', mockLogger);
            expect(mockLogger.error).toHaveBeenCalledTimes(3);
        });

        test('should load existing status file and reset running state', async () => {
            const existingStatus = {
                ...statusUpdater._getDefaultStatus(),
                status: 'running:initial', // Stale state
                pid: 123,
                lastSyncTimestamp: '2023-10-26T10:00:00Z',
            };
            mockReadFile.mockResolvedValue(JSON.stringify(existingStatus));

            // Call initializeStatus with the FULL path
            await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);

            expect(mockReadFile).toHaveBeenCalledWith(expectedStatusPath, 'utf8');
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Found stale \'running\' status'));
            expect(mockWriteFile).toHaveBeenCalled(); // Should write back the cleaned status
            // Check internal status via exported getter
            const status = statusUpdater._getCurrentStatus();
            expect(status.status).toBe('idle'); // Reset to idle
            expect(status.pid).toBeNull();
            expect(status.lastSyncTimestamp).toBe('2023-10-26T10:00:00Z'); // Keep other loaded fields
        });

        test('should initialize with defaults and create file if not found', async () => {
            const error = new Error('File not found');
            error.code = 'ENOENT';
            mockReadFile.mockRejectedValue(error);

            // Call initializeStatus with the FULL path
            await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);

            expect(mockReadFile).toHaveBeenCalledWith(expectedStatusPath, 'utf8');
            expect(mockLogger.info).toHaveBeenCalledWith('Status file not found, initializing with default status.');
            // Check write with default status
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(statusUpdater._getDefaultStatus(), null, 2), 'utf8');
            expect(statusUpdater._getCurrentStatus()).toEqual(statusUpdater._getDefaultStatus());
        });
        
        test('should use defaults and log error if file read fails (non-ENOENT)', async () => {
            const error = new Error('Read failed');
            mockReadFile.mockRejectedValue(error);

            // Call initializeStatus with the FULL path
            await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);
            
            // Use exact error message check
            expect(mockLogger.error).toHaveBeenCalledWith(`Error loading status file ${expectedStatusPath}, using defaults: ${error.message}`);
            expect(mockWriteFile).not.toHaveBeenCalled();
            expect(statusUpdater._getCurrentStatus()).toEqual(statusUpdater._getDefaultStatus());
        });

         test('should use defaults and log error if file has invalid JSON', async () => {
             const invalidJsonString = 'invalid json';
             mockReadFile.mockResolvedValue(invalidJsonString);

             await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);
             
             // Check exact error message (parsing error message might vary slightly by Node version)
             expect(mockLogger.error).toHaveBeenCalledWith(expect.stringMatching(/^Error loading status file.*using defaults: Unexpected token .*JSON/));
             expect(mockWriteFile).not.toHaveBeenCalled();
             expect(statusUpdater._getCurrentStatus()).toEqual(statusUpdater._getDefaultStatus());
         });
    });

    // writeStatusToFile is internal, test via functions that call it (updateStatus etc)
    describe('updateStatus', () => {
        beforeEach(async () => {
            // Ensure module is initialized for these tests, mock read to avoid errors
            mockReadFile.mockRejectedValue({ code: 'ENOENT' }); // Simulate file not found initially
            await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);
            mockWriteFile.mockClear(); // Clear the initial write from initializeStatus
        });

        test('should log error but not throw if path not initialized', async () => {
            statusUpdater._resetStatusModule(); // Explicitly de-initialize
            const updates = { status: 'testing' };
            await statusUpdater.updateStatus(updates, mockLogger);
            expect(mockLogger.error).toHaveBeenCalledWith('Status updater not initialized. Call initializeStatus first.');
            expect(mockWriteFile).not.toHaveBeenCalled();
            // Should still update in-memory status
            expect(statusUpdater._getCurrentStatus()).toEqual(expect.objectContaining(updates));
        });

        test('should update internal status and write to file', async () => {
            const updates = { status: 'running:test', pid: 999 };
            const expectedStatus = { ...statusUpdater._getDefaultStatus(), ...updates };

            await statusUpdater.updateStatus(updates, mockLogger);
            
            expect(statusUpdater._getCurrentStatus()).toEqual(expectedStatus);
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(expectedStatus, null, 2), 'utf8');
        });
    });
    
    describe('setSyncStartStatus', () => {
        beforeEach(async () => {
            mockReadFile.mockRejectedValue({ code: 'ENOENT' });
            await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);
            mockWriteFile.mockClear();
             // Mock process.pid
             Object.defineProperty(process, 'pid', { value: 12345, writable: true });
             // Mock Date
             const constantDate = new Date('2024-01-10T12:00:00.000Z');
             global.Date = class extends Date {
                 constructor() {
                     super();
                     return constantDate;
                 }
             };
        });
         afterEach(() => {
             // Restore original Date constructor
             global.Date = Date;
         });

        test('should set correct fields for starting sync', async () => {
            const runType = 'incremental';
            const totalItems = 150;
            const lastSync = '2024-01-01T00:00:00Z';

            await statusUpdater.setSyncStartStatus(runType, totalItems, lastSync, mockLogger);

            const expectedStatus = {
                ...statusUpdater._getDefaultStatus(),
                status: `running:${runType}`,
                pid: 12345,
                currentRunStartTimeISO: '2024-01-10T12:00:00.000Z',
                currentRunTotalItems: totalItems,
                currentRunItemsDownloaded: 0,
                lastSyncTimestamp: lastSync,
            };
            expect(statusUpdater._getCurrentStatus()).toEqual(expectedStatus);
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(expectedStatus, null, 2), 'utf8');
        });
    });

    describe('incrementDownloadedCount', () => {
        const total = 25;
        const WRITE_INTERVAL = statusUpdater._getWriteInterval(); // Use exported const

        beforeEach(async () => {
             await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);
             await statusUpdater.setSyncStartStatus('initial', total, null, mockLogger);
             mockWriteFile.mockClear(); 
        });

        test('should increment counter but not write immediately', async () => {
            await statusUpdater.incrementDownloadedCount(mockLogger);
            expect(statusUpdater._getCurrentStatus().currentRunItemsDownloaded).toBe(1);
            expect(mockWriteFile).not.toHaveBeenCalled();
        });

        test('should write status after WRITE_INTERVAL increments', async () => {
            for (let i = 0; i < WRITE_INTERVAL; i++) {
                await statusUpdater.incrementDownloadedCount(mockLogger);
            }
            expect(statusUpdater._getCurrentStatus().currentRunItemsDownloaded).toBe(WRITE_INTERVAL);
            expect(mockWriteFile).toHaveBeenCalledTimes(1);
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, expect.stringContaining(`"currentRunItemsDownloaded": ${WRITE_INTERVAL}`), 'utf8');
        });

        test('should write status when count reaches total', async () => {
             // Increment to total-1, then one more should trigger write
             for (let i = 0; i < total - 1; i++) {
                 await statusUpdater.incrementDownloadedCount(mockLogger);
             }
             mockWriteFile.mockClear(); // Clear any previous writes
             
             // This final increment should trigger a write because we reached total
             await statusUpdater.incrementDownloadedCount(mockLogger);
             expect(statusUpdater._getCurrentStatus().currentRunItemsDownloaded).toBe(total);
             expect(mockWriteFile).toHaveBeenCalledTimes(1);
             expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, expect.stringContaining(`"currentRunItemsDownloaded": ${total}`), 'utf8');
        });
    });
    
    describe('setSyncEndStatus', () => {
        test('should set idle status and summary on success', async () => {
            await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);
            // Set status to non-idle first
            await statusUpdater.updateStatus({ status: 'running:test' }, mockLogger);
            mockWriteFile.mockClear(); // Clear the write from updateStatus
            
            const summary = 'Run successful.';
            const expectedStatus = { ...statusUpdater._getCurrentStatus(), status: 'idle', pid: null, lastRunSummary: summary };
            
            await statusUpdater.setSyncEndStatus(true, summary, mockLogger);
            
            expect(statusUpdater._getCurrentStatus()).toEqual(expectedStatus);
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(expectedStatus, null, 2), 'utf8');
        });

        test('should set failed status and summary on failure', async () => {
             await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);
             // Set status to non-idle first
             await statusUpdater.updateStatus({ status: 'running:test' }, mockLogger);
             mockWriteFile.mockClear(); // Clear the write from updateStatus
             
             const summary = 'Run failed critically.';
             const expectedStatus = { ...statusUpdater._getCurrentStatus(), status: 'failed', pid: null, lastRunSummary: summary };
            
             await statusUpdater.setSyncEndStatus(false, summary, mockLogger);
            
             expect(statusUpdater._getCurrentStatus()).toEqual(expectedStatus);
             expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(expectedStatus, null, 2), 'utf8');
        });
    });
    
    describe('setIdleStatus', () => {
        test('should set status to idle if not already idle', async () => {
            await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);
            // Set status to non-idle first
            await statusUpdater.updateStatus({ status: 'running:test' }, mockLogger);
            mockWriteFile.mockClear(); // Clear the write from updateStatus
            
            const expectedStatus = { ...statusUpdater._getCurrentStatus(), status: 'idle', pid: null };
            
            await statusUpdater.setIdleStatus(mockLogger);
            
            expect(statusUpdater._getCurrentStatus()).toEqual(expectedStatus);
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(expectedStatus, null, 2), 'utf8');
        });
        
        test('should not write if status is already idle', async () => {
            await statusUpdater.initializeStatus(expectedStatusPath, mockLogger);
            // Status is already 'idle' by default, just clear any writes from init
            mockWriteFile.mockClear(); // Clear any writes from init
            
            await statusUpdater.setIdleStatus(mockLogger);
            
            expect(mockWriteFile).not.toHaveBeenCalled();
        });
    });
}); 