const fs = require('fs').promises;
const { loadState, saveState, defaultState } = require('../src/stateManager');

// Mock fs.promises module
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        // Mocks needed by other tests if run together
        chmod: jest.fn(),
        readdir: jest.fn(),
        stat: jest.fn(),
    },
    existsSync: jest.requireActual('fs').existsSync,
    readFileSync: jest.requireActual('fs').readFileSync,
}));

// Mock logger
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

const mockStateFilePath = '/fake/state.json';

describe('State Manager', () => {
    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();
        // Reset fs mocks specifically if needed elsewhere
        fs.readFile.mockReset();
        fs.writeFile.mockReset();
    });

    describe('loadState', () => {
        test('should load state successfully from existing file', async () => {
            const existingState = { lastSyncTimestamp: '2023-01-01T00:00:00Z' };
            fs.readFile.mockResolvedValue(JSON.stringify(existingState));

            const state = await loadState(mockStateFilePath, mockLogger);

            expect(state).toEqual(existingState);
            expect(fs.readFile).toHaveBeenCalledWith(mockStateFilePath, 'utf8');
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('State loaded successfully'));
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        test('should return default state if file does not exist', async () => {
            const error = new Error('ENOENT');
            error.code = 'ENOENT';
            fs.readFile.mockRejectedValue(error);

            const state = await loadState(mockStateFilePath, mockLogger);

            expect(state).toEqual(defaultState);
            expect(fs.readFile).toHaveBeenCalledWith(mockStateFilePath, 'utf8');
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('State file not found'));
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        test('should return default state if file contains invalid JSON', async () => {
            fs.readFile.mockResolvedValue('{\"invalidJson:}');

            const state = await loadState(mockStateFilePath, mockLogger);

            expect(state).toEqual(defaultState);
            expect(fs.readFile).toHaveBeenCalledWith(mockStateFilePath, 'utf8');
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error parsing state file at /fake/state.json (invalid JSON). Initializing with default state. Error:'));
        });

        test('should return default state on other file read errors', async () => {
            const error = new Error('Permission denied');
            fs.readFile.mockRejectedValue(error);

            const state = await loadState(mockStateFilePath, mockLogger);

            expect(state).toEqual(defaultState);
            expect(fs.readFile).toHaveBeenCalledWith(mockStateFilePath, 'utf8');
            expect(mockLogger.error).toHaveBeenCalledWith(`Error loading state file from ${mockStateFilePath}. Initializing with default state. Error: ${error.message}`);
        });
    });

    describe('saveState', () => {
        test('should save state successfully', async () => {
            const stateToSave = { lastSyncTimestamp: '2024-01-01T12:00:00Z' };
            const expectedJsonString = JSON.stringify(stateToSave, null, 2);
            fs.writeFile.mockResolvedValue(); // Simulate successful write

            await saveState(mockStateFilePath, stateToSave, mockLogger);

            expect(fs.writeFile).toHaveBeenCalledWith(mockStateFilePath, expectedJsonString, 'utf8');
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('State saved successfully'));
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

        test('should throw error if saving fails', async () => {
            const stateToSave = { lastSyncTimestamp: '2024-01-01T12:00:00Z' };
            const error = new Error('Disk full');
            fs.writeFile.mockRejectedValue(error);

            await expect(saveState(mockStateFilePath, stateToSave, mockLogger))
                .rejects.toThrow(`Failed to save state: ${error.message}`);

            expect(fs.writeFile).toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(`Error saving state file to ${mockStateFilePath}: ${error.message}`);
        });
    });
}); 