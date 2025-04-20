const { runInitialSync } = require('../src/syncManager');
const googlePhotosApi = require('../src/googlePhotosApi');
const downloader = require('../src/downloader');

// Mock dependencies
jest.mock('../src/googlePhotosApi');
jest.mock('../src/downloader');

// Mock logger
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

const mockAuth = 'mock-auth-token'; // Can be string or object depending on API module
const mockDir = '/fake/sync-dir';

describe('Sync Manager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Provide default resolves for mocks
        googlePhotosApi.getAllMediaItems.mockResolvedValue([]);
        downloader.ensureDirectoryExists.mockResolvedValue();
        downloader.downloadMediaItem.mockResolvedValue(true);
    });

    describe('runInitialSync', () => {
        test('should ensure directory, fetch items, and download each one', async () => {
            const item1 = { id: 'id1', filename: 'file1.jpg' };
            const item2 = { id: 'id2', filename: 'file2.png' };
            googlePhotosApi.getAllMediaItems.mockResolvedValue([item1, item2]);
            downloader.downloadMediaItem.mockResolvedValue(true); // Both succeed

            const result = await runInitialSync(mockAuth, mockDir, mockLogger);

            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(mockDir, mockLogger);
            expect(googlePhotosApi.getAllMediaItems).toHaveBeenCalledWith(mockAuth, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(2);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(item1, mockDir, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(item2, mockDir, mockLogger);
            expect(mockLogger.info).toHaveBeenCalledWith('Starting initial synchronization...');
            expect(mockLogger.info).toHaveBeenCalledWith(`Total items to process for initial sync: 2`);
            expect(mockLogger.info).toHaveBeenCalledWith('Initial synchronization finished.');
            expect(mockLogger.info).toHaveBeenCalledWith('Summary: Processed: 2, Succeeded/Skipped: 2, Failed: 0');
            expect(result).toEqual({ success: true, itemsProcessed: 2, itemsDownloaded: 2, itemsFailed: 0 });
        });

        test('should handle download failures for some items', async () => {
            const item1 = { id: 'id1', filename: 'file1.jpg' };
            const item2 = { id: 'id2', filename: 'file2.png' }; // This one fails
            const item3 = { id: 'id3', filename: 'file3.gif' };
            googlePhotosApi.getAllMediaItems.mockResolvedValue([item1, item2, item3]);
            downloader.downloadMediaItem
                .mockResolvedValueOnce(true) // item1 succeeds
                .mockResolvedValueOnce(false) // item2 fails (returns false)
                .mockResolvedValueOnce(true); // item3 succeeds

            const result = await runInitialSync(mockAuth, mockDir, mockLogger);

            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(3);
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to process item id2'));
            expect(mockLogger.info).toHaveBeenCalledWith('Summary: Processed: 3, Succeeded/Skipped: 2, Failed: 1');
            expect(result).toEqual({ success: true, itemsProcessed: 3, itemsDownloaded: 2, itemsFailed: 1 });
        });

       test('should handle critical download errors (promise rejection)', async () => {
            const item1 = { id: 'id1', filename: 'file1.jpg' };
            const item2 = { id: 'id2', filename: 'file2.png' }; // This one fails critically
            const downloadError = new Error('Write permission error');
            googlePhotosApi.getAllMediaItems.mockResolvedValue([item1, item2]);
            downloader.downloadMediaItem
                .mockResolvedValueOnce(true) // item1 succeeds
                .mockRejectedValueOnce(downloadError); // item2 fails (rejects)
                
            const result = await runInitialSync(mockAuth, mockDir, mockLogger);

            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(2);
            expect(mockLogger.error).toHaveBeenCalledWith(`Critical error downloading item ${item2.id} (${item2.filename}): ${downloadError.message}`);
            expect(mockLogger.info).toHaveBeenCalledWith('Summary: Processed: 2, Succeeded/Skipped: 1, Failed: 1');
            expect(result).toEqual({ success: true, itemsProcessed: 2, itemsDownloaded: 1, itemsFailed: 1 });
        });

        test('should return failure if ensureDirectoryExists fails', async () => {
            const error = new Error('Cannot create dir');
            downloader.ensureDirectoryExists.mockRejectedValue(error);

            const result = await runInitialSync(mockAuth, mockDir, mockLogger);

            expect(googlePhotosApi.getAllMediaItems).not.toHaveBeenCalled();
            expect(downloader.downloadMediaItem).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(`Initial synchronization failed critically: ${error.message}`);
            expect(result).toEqual({ success: false, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: 0 });
        });

        test('should return failure if getAllMediaItems fails', async () => {
            const error = new Error('API Error');
            googlePhotosApi.getAllMediaItems.mockRejectedValue(error);

            const result = await runInitialSync(mockAuth, mockDir, mockLogger);

            expect(downloader.ensureDirectoryExists).toHaveBeenCalled();
            expect(downloader.downloadMediaItem).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(`Initial synchronization failed critically: ${error.message}`);
             // itemsProcessed is 0 because the error happened before counting items
            expect(result).toEqual({ success: false, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: 0 });
        });
        
         test('should handle zero media items found', async () => {
            googlePhotosApi.getAllMediaItems.mockResolvedValue([]);

            const result = await runInitialSync(mockAuth, mockDir, mockLogger);

            expect(downloader.ensureDirectoryExists).toHaveBeenCalled();
            expect(googlePhotosApi.getAllMediaItems).toHaveBeenCalled();
            expect(downloader.downloadMediaItem).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith(`Total items to process for initial sync: 0`);
            expect(mockLogger.info).toHaveBeenCalledWith('Initial synchronization finished.');
            expect(mockLogger.info).toHaveBeenCalledWith('Summary: Processed: 0, Succeeded/Skipped: 0, Failed: 0');
            expect(result).toEqual({ success: true, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: 0 });
        });
    });
}); 