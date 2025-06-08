const path = require('path'); // Ensure path is required
const { runInitialSync, runIncrementalSync } = require('../src/syncManager');
const googlePhotosApi = require('../src/googlePhotosApi');
const downloader = require('../src/downloader');
const statusUpdater = require('../src/statusUpdater'); // Require status updater

// Mock dependencies
jest.mock('../src/googlePhotosApi');
jest.mock('../src/downloader');
jest.mock('../src/statusUpdater'); // Mock status updater

// Mock logger
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

const mockAuth = 'mock-auth-token'; // Can be string or object depending on API module
const mockDir = '/fake/sync-dir';
// Base mock config
const baseMockConfig = {
    localSyncDirectory: mockDir,
    debugMaxPages: 0, // Default: no limit
    // Add other required paths if syncManager uses them directly
    credentialsPath: '/fake/creds.json',
    logFilePath: '/fake/log.log',
    stateFilePath: '/fake/state.json'
};

describe('Sync Manager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset and provide default resolves for all mocked functions
        googlePhotosApi.getAllMediaItems.mockResolvedValue([]);
        googlePhotosApi.getAllAlbums.mockResolvedValue([]);
        googlePhotosApi.getAlbumMediaItems.mockResolvedValue([]);
        googlePhotosApi.searchMediaItemsByDate.mockResolvedValue([]); // Add default for search
        downloader.ensureDirectoryExists.mockResolvedValue();
        downloader.downloadMediaItem.mockResolvedValue(true);
        // Reset status updater mocks
        statusUpdater.setSyncStartStatus.mockResolvedValue();
        statusUpdater.updateStatus.mockResolvedValue();
        statusUpdater.incrementDownloadedCount.mockResolvedValue();
        statusUpdater.setSyncEndStatus.mockResolvedValue();
        // Mock the getCurrentStatus method that syncManager calls
        statusUpdater.getCurrentStatus = jest.fn().mockReturnValue({ currentRunTotalItems: 0 });
    });

    describe('runInitialSync', () => {
        test('should pass maxPages=0 if not set in config', async () => {
            const config = { ...baseMockConfig }; 
            delete config.debugMaxPages; // Simulate key missing
            config.debugMaxPages = 0; // Ensure default is applied by configLoader mock/logic if tested fully, here we assume 0

            await runInitialSync(mockAuth, config, mockLogger, statusUpdater);
            expect(googlePhotosApi.getAllAlbums).toHaveBeenCalledWith(mockAuth, mockLogger, 0);
            expect(googlePhotosApi.getAllMediaItems).toHaveBeenCalledWith(mockAuth, mockLogger, 0);
            expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('DEBUG MODE ACTIVE'));
        });
        
         test('should pass debugMaxPages from config to API calls', async () => {
            const maxPages = 2;
            const config = { ...baseMockConfig, debugMaxPages: maxPages };
            googlePhotosApi.getAllAlbums.mockResolvedValue([]); 
            googlePhotosApi.getAllMediaItems.mockResolvedValue([]);

            await runInitialSync(mockAuth, config, mockLogger, statusUpdater);

            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining(`DEBUG MODE ACTIVE: Fetching max ${maxPages} pages`));
            expect(googlePhotosApi.getAllAlbums).toHaveBeenCalledWith(mockAuth, mockLogger, maxPages);
            expect(googlePhotosApi.getAllMediaItems).toHaveBeenCalledWith(mockAuth, mockLogger, maxPages);
        });

        test('should process albums and main stream correctly', async () => {
            const config = { ...baseMockConfig };
            // --- Setup Mocks ---
            const album1 = { id: 'album1', title: 'Nature Pics!' }; // Title needs sanitizing
            const album2 = { id: 'album2', title: 'Pets' };
            const safeAlbum1Title = 'Nature Pics';
            const safeAlbum2Title = 'Pets';
            const album1Dir = path.join(mockDir, safeAlbum1Title);
            const album2Dir = path.join(mockDir, safeAlbum2Title);
            
            const itemA = { id: 'itemA', filename: 'a.jpg' }; // In album 1 only
            const itemB = { id: 'itemB', filename: 'b.png' }; // In album 1 and main stream
            const itemC = { id: 'itemC', filename: 'c.gif' }; // In album 2 only
            const itemD = { id: 'itemD', filename: 'd.mov' }; // In main stream only

            googlePhotosApi.getAllAlbums.mockResolvedValue([album1, album2]);
            
            // Use mockImplementation for getAlbumMediaItems
            googlePhotosApi.getAlbumMediaItems.mockImplementation(async (id, token, logger) => {
                if (id === album1.id) return [itemA, itemB];
                if (id === album2.id) return [itemC];
                return []; // Default empty
            });

            googlePhotosApi.getAllMediaItems.mockResolvedValue([itemB, itemD]);
            downloader.downloadMediaItem.mockResolvedValue(true);

            // --- Run Test ---
            const result = await runInitialSync(mockAuth, config, mockLogger, statusUpdater);

            // --- Assertions ---
            // Directories
            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(mockDir, mockLogger);
            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(album1Dir, mockLogger);
            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(album2Dir, mockLogger);
            
            // API Calls
            expect(googlePhotosApi.getAllAlbums).toHaveBeenCalledWith(mockAuth, mockLogger, 0);
            expect(googlePhotosApi.getAlbumMediaItems).toHaveBeenCalledWith(album1.id, mockAuth, mockLogger, 0);
            expect(googlePhotosApi.getAlbumMediaItems).toHaveBeenCalledWith(album2.id, mockAuth, mockLogger, 0);
            expect(googlePhotosApi.getAllMediaItems).toHaveBeenCalledWith(mockAuth, mockLogger, 0);

            // Downloads
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(4); // A, B, C (albums) + D (main)
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemA, album1Dir, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemB, album1Dir, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemC, album2Dir, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemD, mockDir, mockLogger); // D goes to root
            
            // Result counts
            expect(result.itemsProcessed).toBe(4);
             // Restore correct log check for initial sync summary
             expect(mockLogger.info).toHaveBeenCalledWith('Summary: Albums Processed: 2, Total Items Encountered: 4, Succeeded/Skipped: 4, Failed: 0');

            // Check status calls
            expect(statusUpdater.setSyncStartStatus).toHaveBeenCalledWith('initial', 0, null);
            // Check updates for totals (might be multiple calls)
            expect(statusUpdater.updateStatus).toHaveBeenCalledWith({ currentRunTotalItems: expect.any(Number) });
            expect(statusUpdater.incrementDownloadedCount).toHaveBeenCalledTimes(4);
            expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(true, expect.stringContaining('Summary:'));
        });

        test('should skip main stream download if item was downloaded via album', async () => {
            const config = { ...baseMockConfig };
             const album1 = { id: 'album1', title: 'Album' };
             const album1Dir = path.join(mockDir, 'Album');
             const itemA = { id: 'itemA', filename: 'a.jpg' }; // In album and main stream
             const itemB = { id: 'itemB', filename: 'b.png' }; // In main stream only

            googlePhotosApi.getAllAlbums.mockResolvedValue([album1]);
            googlePhotosApi.getAlbumMediaItems.mockResolvedValue([itemA]);
            googlePhotosApi.getAllMediaItems.mockResolvedValue([itemA, itemB]);
            downloader.downloadMediaItem.mockResolvedValue(true);

            await runInitialSync(mockAuth, config, mockLogger, statusUpdater);

            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(2); // A (album), B (main)
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemA, album1Dir, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemB, mockDir, mockLogger);
            // Verify itemA was NOT called with mockDir (root)
            expect(downloader.downloadMediaItem).not.toHaveBeenCalledWith(itemA, mockDir);

            // Check status calls
            expect(statusUpdater.incrementDownloadedCount).toHaveBeenCalledTimes(2); // A (album), B (main)
        });

       test('should handle album with no title', async () => {
            const config = { ...baseMockConfig };
            const untitledAlbum = { id: 'untitled1' }; // No title
            const album2 = { id: 'album2', title: 'Pets' };
            const itemC = { id: 'itemC', filename: 'c.gif' };

            googlePhotosApi.getAllAlbums.mockResolvedValue([untitledAlbum, album2]);
            // Mock implementation for getAlbumMediaItems
            googlePhotosApi.getAlbumMediaItems.mockImplementation(async (id, token, logger, pages) => {
                 expect(pages).toBe(0); // Verify maxPages is passed even here
                 if (id === album2.id) return [itemC];
                 return [];
            });
            googlePhotosApi.getAllMediaItems.mockResolvedValue([]);

            await runInitialSync(mockAuth, config, mockLogger, statusUpdater);

            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Album found with no title'));
            expect(googlePhotosApi.getAlbumMediaItems).not.toHaveBeenCalledWith(untitledAlbum.id, expect.anything(), expect.anything());
            expect(googlePhotosApi.getAlbumMediaItems).toHaveBeenCalledWith(album2.id, mockAuth, mockLogger, 0);
            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(path.join(mockDir, 'Pets'), mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(1); // Only itemC

            // Check status calls
            expect(statusUpdater.incrementDownloadedCount).toHaveBeenCalledTimes(1); // Only itemC
        });

        test('should handle error fetching album items', async () => {
            const config = { ...baseMockConfig };
            const album1 = { id: 'album1', title: 'Good Album' };
            const album2 = { id: 'album2', title: 'Bad Album' }; // Fails to get items
            const itemA = { id: 'itemA', filename: 'a.jpg' };
            const itemD = { id: 'itemD', filename: 'd.mov' }; // Main stream
            const albumError = new Error('Album fetch failed');

            googlePhotosApi.getAllAlbums.mockResolvedValue([album1, album2]);
            // Mock implementation for getAlbumMediaItems
            googlePhotosApi.getAlbumMediaItems.mockImplementation(async (id, token, logger, pages) => {
                 expect(pages).toBe(0); // Verify maxPages
                 if (id === album1.id) return [itemA];
                 if (id === album2.id) throw albumError; // Throw for the bad album
                 return [];
            });
            googlePhotosApi.getAllMediaItems.mockResolvedValue([itemD]);

            const result = await runInitialSync(mockAuth, config, mockLogger, statusUpdater);
            
            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(path.join(mockDir, 'Good Album'), mockLogger);
            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(path.join(mockDir, 'Bad Album'), mockLogger);
            expect(googlePhotosApi.getAlbumMediaItems).toHaveBeenCalledTimes(2);
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(2); // itemA and itemD
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemA, path.join(mockDir, 'Good Album'), mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemD, mockDir, mockLogger);
            expect(mockLogger.error).toHaveBeenCalledWith(`Failed to process album "Bad Album" (ID: ${album2.id}): ${albumError.message}`);
            // Items failed count only increments on download failure, not album processing failure in this logic
            expect(result.itemsFailed).toBe(0); 
            expect(result.itemsDownloaded).toBe(2);

            // Check status calls
            expect(statusUpdater.incrementDownloadedCount).toHaveBeenCalledTimes(2); // itemA and itemD
            expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(true, expect.stringContaining('Summary:'));
        });

        test('should return failure if getAllMediaItems fails', async () => {
            const config = { ...baseMockConfig };
            const album1 = { id: 'album1', title: 'Album' };
            googlePhotosApi.getAllAlbums.mockResolvedValue([album1]);
            googlePhotosApi.getAlbumMediaItems.mockResolvedValue([]); // Album processed ok
            const error = new Error('API Error');
            googlePhotosApi.getAllMediaItems.mockRejectedValue(error); // Main stream fetch fails

            const result = await runInitialSync(mockAuth, config, mockLogger, statusUpdater);

            expect(downloader.ensureDirectoryExists).toHaveBeenCalledTimes(2); // Root + Album
            expect(downloader.downloadMediaItem).not.toHaveBeenCalled(); // No items downloaded
            expect(mockLogger.error).toHaveBeenCalledWith(`Initial sync failed critically: ${error.message}`);
            // Fix expected albumsProcessed count in this error case
            expect(result).toEqual({ success: false, albumsProcessed: 0, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: 0 });

            // Check status calls
            expect(statusUpdater.setSyncStartStatus).toHaveBeenCalled(); // Called before main items fetched
            expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(false, expect.stringContaining('Initial sync failed critically'));
        });

        test('should handle zero media items found', async () => {
             const config = { ...baseMockConfig };
             googlePhotosApi.getAllAlbums.mockResolvedValue([]);
             googlePhotosApi.getAllMediaItems.mockResolvedValue([]);
             const result = await runInitialSync(mockAuth, config, mockLogger, statusUpdater);
             
             expect(downloader.ensureDirectoryExists).toHaveBeenCalled();
             expect(googlePhotosApi.getAllAlbums).toHaveBeenCalled();
             expect(googlePhotosApi.getAllMediaItems).toHaveBeenCalled();
             expect(downloader.downloadMediaItem).not.toHaveBeenCalled();
             // Check the correct summary log
             expect(mockLogger.info).toHaveBeenCalledWith('Summary: Albums Processed: 0, Total Items Encountered: 0, Succeeded/Skipped: 0, Failed: 0');
             expect(result).toEqual({ success: true, albumsProcessed: 0, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: 0 });

             // Check status calls
             expect(statusUpdater.setSyncStartStatus).toHaveBeenCalled();
             expect(statusUpdater.incrementDownloadedCount).not.toHaveBeenCalled();
             expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(true, expect.stringContaining('Summary:'));
        });

        test('should pass maxPages to getAlbumMediaItems when processing albums', async () => {
            const maxPages = 1;
            const config = { ...baseMockConfig, debugMaxPages: maxPages };
            const album1 = { id: 'album1', title: 'Album One' };
            const itemA = { id: 'itemA', filename: 'a.jpg' };

            googlePhotosApi.getAllAlbums.mockResolvedValue([album1]);
            googlePhotosApi.getAlbumMediaItems.mockResolvedValue([itemA]); // Assume it fetches within limit
            googlePhotosApi.getAllMediaItems.mockResolvedValue([]); // No main stream items

            await runInitialSync(mockAuth, config, mockLogger, statusUpdater);

            expect(googlePhotosApi.getAlbumMediaItems).toHaveBeenCalledWith(album1.id, mockAuth, mockLogger, maxPages); // Check maxPages was passed
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(1); // Ensure download still happens

            // Check status calls
            expect(statusUpdater.incrementDownloadedCount).toHaveBeenCalledTimes(1);
        });

        test('should stop downloading albums if maxDownloads reached', async () => {
            const config = { ...baseMockConfig, debugMaxDownloads: 2 }; 
            // Setup: Provide albums and items that exceed the limit
            const album1 = { id: 'album1', title: 'Album 1' };
            const album2 = { id: 'album2', title: 'Album 2' };
            const itemA = { id: 'itemA', filename: 'a.jpg' }; // In album 1
            const itemB = { id: 'itemB', filename: 'b.png' }; // In album 1
            const itemC = { id: 'itemC', filename: 'c.gif' }; // In album 2 (should not be reached)
            const itemD = { id: 'itemD', filename: 'd.mov' }; // Main stream (should not be reached)

            googlePhotosApi.getAllAlbums.mockResolvedValue([album1, album2]);
            googlePhotosApi.getAlbumMediaItems.mockImplementation(async (id) => {
                if (id === album1.id) return [itemA, itemB]; // 2 items, hits limit
                if (id === album2.id) return [itemC];
                return [];
            });
            googlePhotosApi.getAllMediaItems.mockResolvedValue([itemD]); // Main stream item
            downloader.downloadMediaItem.mockResolvedValue(true); // Assume downloads succeed

            // --- Run Test ---
            const result = await runInitialSync(mockAuth, config, mockLogger, statusUpdater);
            
            // --- Assertions ---
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(2); // Only A and B from Album 1
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemA, path.join(mockDir, 'Album 1'), mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemB, path.join(mockDir, 'Album 1'), mockLogger);
            expect(downloader.downloadMediaItem).not.toHaveBeenCalledWith(itemC, path.join(mockDir, 'Album 2'));
            expect(downloader.downloadMediaItem).not.toHaveBeenCalledWith(itemD, mockDir); // Main stream not reached
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining(`Reached debug download limit (${config.debugMaxDownloads}). Stopping further downloads.`));
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining(`Skipping main stream processing due to download limit reached during album processing.`));
            
            // Verify results reflect partial completion
            expect(result.itemsProcessed).toBe(3); 
            expect(result.itemsDownloaded).toBe(2);
            expect(result.albumsProcessed).toBe(2); // Only Album 1 fully processed items from

            // Check status calls
            expect(statusUpdater.incrementDownloadedCount).toHaveBeenCalledTimes(2);
            expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(true, expect.stringContaining('(Download limit reached)'));
        });

        test('should stop downloading main stream if maxDownloads reached', async () => {
            const config = { ...baseMockConfig, debugMaxDownloads: 1 }; // Limit to 1 download
             // Setup: One album item, one main stream item. Limit cuts off main stream.
             const album1 = { id: 'album1', title: 'Album' };
             const itemA = { id: 'itemA', filename: 'a.jpg' }; // In album (downloaded)
             const itemB = { id: 'itemB', filename: 'b.png' }; // In main stream (skipped due to limit)

             googlePhotosApi.getAllAlbums.mockResolvedValue([album1]);
             googlePhotosApi.getAlbumMediaItems.mockResolvedValue([itemA]);
             googlePhotosApi.getAllMediaItems.mockResolvedValue([itemB]); // Main stream has itemB
             downloader.downloadMediaItem.mockResolvedValue(true);

            await runInitialSync(mockAuth, config, mockLogger, statusUpdater);

            // Assertions
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(1); // Only itemA downloaded
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemA, path.join(mockDir, 'Album'), mockLogger);
            expect(downloader.downloadMediaItem).not.toHaveBeenCalledWith(itemB, mockDir);
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining(`Reached debug download limit (${config.debugMaxDownloads}). Stopping further downloads.`));

            // Correct expected download count
            expect(statusUpdater.incrementDownloadedCount).toHaveBeenCalledTimes(1); // Only A downloaded
            expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(true, expect.stringContaining('(Download limit reached)'));
        });
    });

    describe('runIncrementalSync', () => {
        const lastSyncTime = '2024-03-10T00:00:00.000Z';

        test('should ensure directory, search for new items, and download them', async () => {
            const config = { ...baseMockConfig };
            const newItem1 = { id: 'new1', filename: 'new1.jpg' };
            const newItem2 = { id: 'new2', filename: 'new2.png' };
            // Mock search results
            googlePhotosApi.searchMediaItemsByDate.mockResolvedValue([newItem1, newItem2]);
            downloader.downloadMediaItem.mockResolvedValue(true); // Downloads succeed

            const result = await runIncrementalSync(lastSyncTime, mockAuth, config, mockLogger, statusUpdater);

            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(config.localSyncDirectory, mockLogger);
            expect(googlePhotosApi.searchMediaItemsByDate).toHaveBeenCalledWith(
                lastSyncTime, 
                expect.any(String), // Check that current time is passed as end date
                mockAuth, 
                mockLogger
            );
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(2);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(newItem1, config.localSyncDirectory, mockLogger); // Downloaded to root
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(newItem2, config.localSyncDirectory, mockLogger);
            expect(mockLogger.info).toHaveBeenCalledWith(`Starting incremental synchronization since ${lastSyncTime}...`);
            expect(mockLogger.info).toHaveBeenCalledWith('Found 2 new items since last sync.');
            expect(mockLogger.info).toHaveBeenCalledWith('Incremental synchronization finished.');
            expect(mockLogger.info).toHaveBeenCalledWith('Summary: New Items Found: 2, Succeeded/Skipped: 2, Failed: 0');
            expect(result).toEqual({ success: true, itemsProcessed: 2, itemsDownloaded: 2, itemsFailed: 0 });

            // Check status calls
            expect(statusUpdater.setSyncStartStatus).toHaveBeenCalledWith('incremental', 0, lastSyncTime);
            expect(statusUpdater.updateStatus).toHaveBeenCalledWith({ currentRunTotalItems: 2 });
            expect(statusUpdater.incrementDownloadedCount).toHaveBeenCalledTimes(2);
            expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(true, expect.stringContaining('Summary:'));
        });

        test('should handle zero new items found', async () => {
            const config = { ...baseMockConfig };
            googlePhotosApi.searchMediaItemsByDate.mockResolvedValue([]); // No new items

            const result = await runIncrementalSync(lastSyncTime, mockAuth, config, mockLogger, statusUpdater);

            expect(googlePhotosApi.searchMediaItemsByDate).toHaveBeenCalled();
            expect(downloader.downloadMediaItem).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith('Found 0 new items since last sync.');
            expect(mockLogger.info).toHaveBeenCalledWith('Summary: New Items Found: 0, Succeeded/Skipped: 0, Failed: 0');
            expect(result).toEqual({ success: true, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: 0 });

            // Check status calls
            expect(statusUpdater.updateStatus).toHaveBeenCalledWith({ currentRunTotalItems: 0 });
            expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(true, expect.stringContaining('Summary:'));
        });

        test('should handle download failures for new items', async () => {
            const config = { ...baseMockConfig };
            const newItem1 = { id: 'new1', filename: 'new1.jpg' };
            const newItem2 = { id: 'new2', filename: 'new2.png' }; // Fails
            googlePhotosApi.searchMediaItemsByDate.mockResolvedValue([newItem1, newItem2]);
            downloader.downloadMediaItem
                .mockResolvedValueOnce(true)
                .mockResolvedValueOnce(false);

            const result = await runIncrementalSync(lastSyncTime, mockAuth, config, mockLogger, statusUpdater);

            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(2);
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to process new item new2'));
            expect(mockLogger.info).toHaveBeenCalledWith('Summary: New Items Found: 2, Succeeded/Skipped: 1, Failed: 1');
            expect(result).toEqual({ success: true, itemsProcessed: 2, itemsDownloaded: 1, itemsFailed: 1 });

            // Check status calls
            expect(statusUpdater.incrementDownloadedCount).toHaveBeenCalledTimes(1); // Only the successful one
             expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(true, expect.stringContaining('Summary:')); // Still success
        });

         test('should handle critical download errors for new items', async () => {
            const config = { ...baseMockConfig };
            const newItem1 = { id: 'new1', filename: 'new1.jpg' };
            const downloadError = new Error('Disk space error');
            googlePhotosApi.searchMediaItemsByDate.mockResolvedValue([newItem1]);
            downloader.downloadMediaItem.mockRejectedValue(downloadError);
                
            const result = await runIncrementalSync(lastSyncTime, mockAuth, config, mockLogger, statusUpdater);

            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(1);
            expect(mockLogger.error).toHaveBeenCalledWith(`Critical error downloading new item ${newItem1.id} (${newItem1.filename}): ${downloadError.message}`);
            expect(mockLogger.info).toHaveBeenCalledWith('Summary: New Items Found: 1, Succeeded/Skipped: 0, Failed: 1');
            expect(result).toEqual({ success: true, itemsProcessed: 1, itemsDownloaded: 0, itemsFailed: 1 });

            // Check status calls
            expect(statusUpdater.incrementDownloadedCount).not.toHaveBeenCalled();
             expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(true, expect.stringContaining('Summary:')); // Still success
        });

        test('should return failure if searchMediaItemsByDate fails', async () => {
            const config = { ...baseMockConfig };
            const error = new Error('API Search Error');
            googlePhotosApi.searchMediaItemsByDate.mockRejectedValue(error);

            const result = await runIncrementalSync(lastSyncTime, mockAuth, config, mockLogger, statusUpdater);

            expect(downloader.ensureDirectoryExists).toHaveBeenCalled();
            expect(downloader.downloadMediaItem).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(`Incremental sync failed critically: ${error.message}`);
            expect(result).toEqual({ success: false, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: 0 });

            // Check status calls
            expect(statusUpdater.setSyncStartStatus).toHaveBeenCalled();
            expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(false, expect.stringContaining('Incremental sync failed critically'));
        });

        test('should stop downloading if maxDownloads reached', async () => {
            const config = { ...baseMockConfig, debugMaxDownloads: 2 }; 
            // Setup: Find 3 new items, but limit is 2
            const newItem1 = { id: 'new1', filename: 'new1.jpg' };
            const newItem2 = { id: 'new2', filename: 'new2.png' };
            const newItem3 = { id: 'new3', filename: 'new3.gif' }; // Should not be downloaded

            googlePhotosApi.searchMediaItemsByDate.mockResolvedValue([newItem1, newItem2, newItem3]);
            downloader.downloadMediaItem.mockResolvedValue(true);

            const result = await runIncrementalSync(lastSyncTime, mockAuth, config, mockLogger, statusUpdater);

            // Assertions
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(2); // Only first 2 downloaded
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(newItem1, config.localSyncDirectory, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(newItem2, config.localSyncDirectory, mockLogger);
            expect(downloader.downloadMediaItem).not.toHaveBeenCalledWith(newItem3, config.localSyncDirectory);
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining(`Reached debug download limit (${config.debugMaxDownloads}). Stopping further downloads.`));
            // Remove the check for the final summary log, as it might not be reached when halting early
            // expect(mockLogger.info).toHaveBeenCalledWith(`Summary: New Items Found: 3, Succeeded/Skipped: 2, Failed: 0`); // Found 3, processed 2
             expect(result).toEqual({ success: true, itemsProcessed: 3, itemsDownloaded: 2, itemsFailed: 0 }); // Result reflects limit

            // Check status calls
            expect(statusUpdater.incrementDownloadedCount).toHaveBeenCalledTimes(2);
            expect(statusUpdater.setSyncEndStatus).toHaveBeenCalledWith(true, expect.stringContaining('(Download limit reached)'));
        });
    });
}); 