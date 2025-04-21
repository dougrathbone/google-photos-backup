const fs = require('fs'); // Require the original fs
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
const mockReadFile = require('fs').promises.readFile;
const mockWriteFile = require('fs').promises.writeFile;

// Mock logger
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

const mockDataDir = '/fake/data/dir';
// Use exported constant for filename
const expectedStatusPath = path.join(mockDataDir, statusUpdater._getStatusFilename()); 
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
        test('should load existing status file and reset running state', async () => {
            const existingStatus = {
                status: 'running:initial',
                pid: 54321, // Stale PID
                lastRunSummary: 'Previous run info'
            };
            mockReadFile.mockResolvedValue(JSON.stringify(existingStatus));
            mockWriteFile.mockResolvedValue();

            await statusUpdater.initializeStatus(mockDataDir, mockLogger);

            expect(mockReadFile).toHaveBeenCalledWith(expectedStatusPath, 'utf8');
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Found stale \'running\' status'));
            expect(mockWriteFile).toHaveBeenCalled(); 
            // Check internal status via exported getter
            const status = statusUpdater._getCurrentStatus();
            expect(status.status).toBe('idle');
            expect(status.pid).toBeNull();
            expect(status.lastRunSummary).toBe('Previous run info'); 
        });

        test('should initialize with defaults and create file if not found', async () => {
            const error = new Error('ENOENT');
            error.code = 'ENOENT';
            mockReadFile.mockRejectedValue(error);
            mockWriteFile.mockResolvedValue();

            await statusUpdater.initializeStatus(mockDataDir, mockLogger);

            expect(mockReadFile).toHaveBeenCalledWith(expectedStatusPath, 'utf8');
            expect(mockLogger.info).toHaveBeenCalledWith('Status file not found, initializing with default status.');
            // Check write with default status
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(statusUpdater._getDefaultStatus(), null, 2), 'utf8');
            expect(statusUpdater._getCurrentStatus()).toEqual(statusUpdater._getDefaultStatus());
        });
        
        test('should use defaults and log error if file read fails (non-ENOENT)', async () => {
            const error = new Error('Read failed');
            mockReadFile.mockRejectedValue(error);

            await statusUpdater.initializeStatus(mockDataDir, mockLogger);
            
            // Use exact error message check
            expect(mockLogger.error).toHaveBeenCalledWith(`Error loading status file ${expectedStatusPath}, using defaults: ${error.message}`);
            expect(mockWriteFile).not.toHaveBeenCalled();
            expect(statusUpdater._getCurrentStatus()).toEqual(statusUpdater._getDefaultStatus());
        });

         test('should use defaults and log error if file has invalid JSON', async () => {
             const invalidJsonString = 'invalid json';
             mockReadFile.mockResolvedValue(invalidJsonString);

             await statusUpdater.initializeStatus(mockDataDir, mockLogger);
             
             // Check exact error message (parsing error message might vary slightly by Node version)
             expect(mockLogger.error).toHaveBeenCalledWith(expect.stringMatching(/^Error loading status file.*using defaults: Unexpected token .*JSON/));
             expect(mockWriteFile).not.toHaveBeenCalled();
             expect(statusUpdater._getCurrentStatus()).toEqual(statusUpdater._getDefaultStatus());
         });
    });

    // writeStatusToFile is internal, test via functions that call it (updateStatus etc)
    describe('updateStatus', () => {
        test('should update internal status and write to file', async () => {
            await statusUpdater.initializeStatus(mockDataDir, mockLogger); // Init first
            mockReadFile.mockRejectedValue({ code: 'ENOENT' }); 
            mockWriteFile.mockResolvedValue();
            const updates = { status: 'running:test', pid: 999 };
            // Use default status from exported getter
            const expectedStatus = { ...statusUpdater._getDefaultStatus(), ...updates }; 

            await statusUpdater.updateStatus(updates, mockLogger);
            
            expect(statusUpdater._getCurrentStatus()).toEqual(expectedStatus);
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(expectedStatus, null, 2), 'utf8');
        });
         test('should log error but not throw if path not initialized', async () => {
             // initializeStatus NOT called first
             const updates = { status: 'running:test', pid: 999 };
             await statusUpdater.updateStatus(updates, mockLogger);
             expect(mockLogger.error).toHaveBeenCalledWith('Status file path not initialized. Call initializeStatus first.');
             // Internal status might update, but write should fail silently
             expect(mockWriteFile).not.toHaveBeenCalled(); 
         });
    });
    
    describe('setSyncStartStatus', () => {
        test('should set correct fields for starting sync', async () => {
            await statusUpdater.initializeStatus(mockDataDir, mockLogger);
            mockWriteFile.mockResolvedValue();
            const lastSync = '2024-01-01T00:00:00Z';
            const totalItems = 150;
            const runType = 'incremental';
            
            // Mock Date constructor for predictable start time
            const mockStartTime = new Date('2024-01-10T12:00:00Z');
            jest.spyOn(global, 'Date').mockImplementation(() => mockStartTime);

            await statusUpdater.setSyncStartStatus(runType, totalItems, lastSync, mockLogger);

            const expectedStatus = {
                ...statusUpdater._getDefaultStatus(), // Start from default
                status: `running:${runType}`,
                pid: 12345, 
                currentRunStartTimeISO: mockStartTime.toISOString(),
                currentRunTotalItems: totalItems,
                currentRunItemsDownloaded: 0,
                lastSyncTimestamp: lastSync
            };
            expect(statusUpdater._getCurrentStatus()).toEqual(expectedStatus);
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(expectedStatus, null, 2), 'utf8');

            global.Date.mockRestore(); // Restore original Date constructor
        });
    });

    describe('incrementDownloadedCount', () => {
        const total = 25;
        const WRITE_INTERVAL = statusUpdater._getWriteInterval(); // Use exported const

        beforeEach(async () => {
             await statusUpdater.initializeStatus(mockDataDir, mockLogger);
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
             // Directly set internal state for this specific test case
            statusUpdater._getCurrentStatus().currentRunItemsDownloaded = total - 1;
            statusUpdater.pendingWrites = 1; // Needs direct access or separate export if kept internal
            // Let's assume pendingWrites isn't directly testable and focus on behavior:
             await statusUpdater.incrementDownloadedCount(mockLogger);
             expect(statusUpdater._getCurrentStatus().currentRunItemsDownloaded).toBe(total);
             expect(mockWriteFile).toHaveBeenCalledTimes(1);
             expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, expect.stringContaining(`"currentRunItemsDownloaded": ${total}`), 'utf8');
        });
    });
    
    describe('setSyncEndStatus', () => {
        test('should set idle status and summary on success', async () => {
            await statusUpdater.initializeStatus(mockDataDir, mockLogger);
            statusUpdater._getCurrentStatus().status = 'running:test'; // Set initial state
            const summary = 'Run successful.';
            const expectedStatus = { ...statusUpdater._getCurrentStatus(), status: 'idle', pid: null, lastRunSummary: summary };
            
            await statusUpdater.setSyncEndStatus(true, summary, mockLogger);
            
            expect(statusUpdater._getCurrentStatus()).toEqual(expectedStatus);
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(expectedStatus, null, 2), 'utf8');
        });

        test('should set failed status and summary on failure', async () => {
             await statusUpdater.initializeStatus(mockDataDir, mockLogger);
             statusUpdater._getCurrentStatus().status = 'running:test'; 
             const summary = 'Run failed critically.';
             const expectedStatus = { ...statusUpdater._getCurrentStatus(), status: 'failed', pid: null, lastRunSummary: summary };
            
             await statusUpdater.setSyncEndStatus(false, summary, mockLogger);
            
             expect(statusUpdater._getCurrentStatus()).toEqual(expectedStatus);
             expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(expectedStatus, null, 2), 'utf8');
        });
    });
    
    describe('setIdleStatus', () => {
        test('should set status to idle if not already idle', async () => {
            await statusUpdater.initializeStatus(mockDataDir, mockLogger);
            statusUpdater._getCurrentStatus().status = 'running:test'; 
            const expectedStatus = { ...statusUpdater._getCurrentStatus(), status: 'idle', pid: null };
            
            await statusUpdater.setIdleStatus(mockLogger);
            
            expect(statusUpdater._getCurrentStatus()).toEqual(expectedStatus);
            expect(mockWriteFile).toHaveBeenCalledWith(expectedStatusPath, JSON.stringify(expectedStatus, null, 2), 'utf8');
        });
        
        test('should not write if status is already idle', async () => {
            await statusUpdater.initializeStatus(mockDataDir, mockLogger);
            statusUpdater._getCurrentStatus().status = 'idle'; 
            mockWriteFile.mockClear(); // Clear any writes from init
            
            await statusUpdater.setIdleStatus(mockLogger);
            
            expect(mockWriteFile).not.toHaveBeenCalled();
        });
    });
}); 