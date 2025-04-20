const fs = require('fs').promises;
const path = require('path');
const { findLatestFileDateRecursive } = require('../src/fileUtils');

// Mock fs.promises
jest.mock('fs', () => ({
    promises: {
        readdir: jest.fn(),
        stat: jest.fn(),
    },
    // Need existsSync for configLoader tests if they run together
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

describe('File Utilities', () => {
    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();
        // Provide default mock implementations
        fs.readdir.mockResolvedValue([]); // Default to empty dir
        fs.stat.mockResolvedValue({ mtime: new Date(0) }); // Default stat
    });

    test('findLatestFileDateRecursive should return null for an empty directory', async () => {
        fs.readdir.mockResolvedValue([]);
        const latestDate = await findLatestFileDateRecursive('/empty', mockLogger);
        expect(latestDate).toBeNull();
        expect(fs.readdir).toHaveBeenCalledWith('/empty', { withFileTypes: true });
        expect(mockLogger.info).not.toHaveBeenCalled(); // No specific info log for truly empty dir
    });

    test('findLatestFileDateRecursive should return null if directory does not exist', async () => {
        const error = new Error('ENOENT: no such file or directory');
        error.code = 'ENOENT';
        fs.readdir.mockRejectedValue(error);
        const latestDate = await findLatestFileDateRecursive('/nonexistent', mockLogger);
        expect(latestDate).toBeNull();
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('not found or is empty'));
    });

    test('findLatestFileDateRecursive should return the latest date among files', async () => {
        const date1 = new Date(2023, 0, 1);
        const date2 = new Date(2023, 0, 10); // Latest
        const date3 = new Date(2023, 0, 5);

        fs.readdir.mockResolvedValue([
            { name: 'file1.txt', isFile: () => true, isDirectory: () => false },
            { name: 'file2.jpg', isFile: () => true, isDirectory: () => false },
            { name: 'file3.png', isFile: () => true, isDirectory: () => false },
        ]);
        fs.stat
            .mockResolvedValueOnce({ mtime: date1 }) // Corresponds to file1.txt
            .mockResolvedValueOnce({ mtime: date2 }) // Corresponds to file2.jpg
            .mockResolvedValueOnce({ mtime: date3 }); // Corresponds to file3.png

        const latestDate = await findLatestFileDateRecursive('/files', mockLogger);
        expect(latestDate).toEqual(date2);
        expect(fs.stat).toHaveBeenCalledTimes(3);
        expect(fs.stat).toHaveBeenCalledWith(path.join('/files', 'file1.txt'));
        expect(fs.stat).toHaveBeenCalledWith(path.join('/files', 'file2.jpg'));
        expect(fs.stat).toHaveBeenCalledWith(path.join('/files', 'file3.png'));
    });

    test('findLatestFileDateRecursive should handle subdirectories', async () => {
        const rootDate = new Date(2023, 1, 1);
        const subDate1 = new Date(2023, 1, 15); // Latest
        const subDate2 = new Date(2023, 1, 10);

        // Mock for root directory
        fs.readdir.mockResolvedValueOnce([
            { name: 'rootfile.txt', isFile: () => true, isDirectory: () => false },
            { name: 'subdir', isFile: () => false, isDirectory: () => true },
        ]);
        // Mock for subdirectory
        fs.readdir.mockResolvedValueOnce([
            { name: 'subfile1.doc', isFile: () => true, isDirectory: () => false },
            { name: 'subfile2.pdf', isFile: () => true, isDirectory: () => false },
        ]);

        fs.stat
            .mockResolvedValueOnce({ mtime: rootDate }) // rootfile.txt
            .mockResolvedValueOnce({ mtime: subDate1 }) // subfile1.doc
            .mockResolvedValueOnce({ mtime: subDate2 }); // subfile2.pdf

        const latestDate = await findLatestFileDateRecursive('/root', mockLogger);

        expect(latestDate).toEqual(subDate1);
        expect(fs.readdir).toHaveBeenCalledTimes(2);
        expect(fs.readdir).toHaveBeenCalledWith('/root', { withFileTypes: true });
        expect(fs.readdir).toHaveBeenCalledWith(path.join('/root', 'subdir'), { withFileTypes: true });
        expect(fs.stat).toHaveBeenCalledTimes(3);
        expect(fs.stat).toHaveBeenCalledWith(path.join('/root', 'rootfile.txt'));
        expect(fs.stat).toHaveBeenCalledWith(path.join('/root', 'subdir', 'subfile1.doc'));
        expect(fs.stat).toHaveBeenCalledWith(path.join('/root', 'subdir', 'subfile2.pdf'));
    });

    test('findLatestFileDateRecursive should ignore stat errors for individual files', async () => {
        const date1 = new Date(2023, 0, 1);
        const statError = new Error('Permission denied');

        fs.readdir.mockResolvedValue([
            { name: 'goodfile.txt', isFile: () => true, isDirectory: () => false },
            { name: 'badfile.txt', isFile: () => true, isDirectory: () => false },
        ]);
        fs.stat
            .mockResolvedValueOnce({ mtime: date1 })
            .mockRejectedValueOnce(statError);

        const latestDate = await findLatestFileDateRecursive('/mixed', mockLogger);
        expect(latestDate).toEqual(date1);
        expect(mockLogger.warn).toHaveBeenCalledWith(`Could not get stats for file ${path.join('/mixed', 'badfile.txt')}: ${statError.message}`);
    });
}); 