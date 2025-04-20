const path = require('path'); // Ensure path is required
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
        // Reset and provide default resolves for all mocked functions
        googlePhotosApi.getAllMediaItems.mockResolvedValue([]);
        googlePhotosApi.getAllAlbums.mockResolvedValue([]);
        googlePhotosApi.getAlbumMediaItems.mockResolvedValue([]);
        downloader.ensureDirectoryExists.mockResolvedValue();
        downloader.downloadMediaItem.mockResolvedValue(true);
    });

    describe('runInitialSync', () => {
        test('should process albums and main stream correctly', async () => {
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
            const result = await runInitialSync(mockAuth, mockDir, mockLogger);

            // --- Assertions ---
            // Directories
            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(mockDir, mockLogger);
            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(album1Dir, mockLogger);
            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(album2Dir, mockLogger);
            
            // API Calls
            expect(googlePhotosApi.getAllAlbums).toHaveBeenCalledWith(mockAuth, mockLogger);
            expect(googlePhotosApi.getAlbumMediaItems).toHaveBeenCalledWith(album1.id, mockAuth, mockLogger);
            expect(googlePhotosApi.getAlbumMediaItems).toHaveBeenCalledWith(album2.id, mockAuth, mockLogger);
            expect(googlePhotosApi.getAllMediaItems).toHaveBeenCalledWith(mockAuth, mockLogger);

            // Downloads
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(4); // A, B, C (albums) + D (main)
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemA, album1Dir, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemB, album1Dir, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemC, album2Dir, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemD, mockDir, mockLogger); // D goes to root
            
            // Result counts
            expect(result).toEqual({
                success: true, 
                albumsProcessed: 2, 
                itemsProcessed: 4, // A, B, C from albums, D from main (B from main skipped)
                itemsDownloaded: 4, 
                itemsFailed: 0
            });
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Summary: Albums: 2, Total Items Encountered: 4, Succeeded/Skipped: 4, Failed: 0'));
        });

        test('should skip main stream download if item was downloaded via album', async () => {
             const album1 = { id: 'album1', title: 'Album' };
             const album1Dir = path.join(mockDir, 'Album');
             const itemA = { id: 'itemA', filename: 'a.jpg' }; // In album and main stream
             const itemB = { id: 'itemB', filename: 'b.png' }; // In main stream only

            googlePhotosApi.getAllAlbums.mockResolvedValue([album1]);
            googlePhotosApi.getAlbumMediaItems.mockResolvedValue([itemA]);
            googlePhotosApi.getAllMediaItems.mockResolvedValue([itemA, itemB]);
            downloader.downloadMediaItem.mockResolvedValue(true);

            await runInitialSync(mockAuth, mockDir, mockLogger);

            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(2); // A (album), B (main)
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemA, album1Dir, mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledWith(itemB, mockDir, mockLogger);
            // Verify itemA was NOT called with mockDir (root)
            expect(downloader.downloadMediaItem).not.toHaveBeenCalledWith(itemA, mockDir, mockLogger);
        });

       test('should handle album with no title', async () => {
            const untitledAlbum = { id: 'untitled1' }; // No title
            const album2 = { id: 'album2', title: 'Pets' };
            const itemC = { id: 'itemC', filename: 'c.gif' };

            googlePhotosApi.getAllAlbums.mockResolvedValue([untitledAlbum, album2]);
            // Mock implementation for getAlbumMediaItems
            googlePhotosApi.getAlbumMediaItems.mockImplementation(async (id, token, logger) => {
                 if (id === album2.id) return [itemC];
                 return [];
            });
            googlePhotosApi.getAllMediaItems.mockResolvedValue([]);

            await runInitialSync(mockAuth, mockDir, mockLogger);

            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Album found with no title'));
            expect(googlePhotosApi.getAlbumMediaItems).not.toHaveBeenCalledWith(untitledAlbum.id, expect.anything(), expect.anything());
            expect(googlePhotosApi.getAlbumMediaItems).toHaveBeenCalledWith(album2.id, mockAuth, mockLogger);
            expect(downloader.ensureDirectoryExists).toHaveBeenCalledWith(path.join(mockDir, 'Pets'), mockLogger);
            expect(downloader.downloadMediaItem).toHaveBeenCalledTimes(1); // Only itemC
        });

        test('should handle error fetching album items', async () => {
            const album1 = { id: 'album1', title: 'Good Album' };
            const album2 = { id: 'album2', title: 'Bad Album' }; // Fails to get items
            const itemA = { id: 'itemA', filename: 'a.jpg' };
            const itemD = { id: 'itemD', filename: 'd.mov' }; // Main stream
            const albumError = new Error('Album fetch failed');

            googlePhotosApi.getAllAlbums.mockResolvedValue([album1, album2]);
            // Mock implementation for getAlbumMediaItems
            googlePhotosApi.getAlbumMediaItems.mockImplementation(async (id, token, logger) => {
                 if (id === album1.id) return [itemA];
                 if (id === album2.id) throw albumError; // Throw for the bad album
                 return [];
            });
            googlePhotosApi.getAllMediaItems.mockResolvedValue([itemD]);

            const result = await runInitialSync(mockAuth, mockDir, mockLogger);
            
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
        });

        test('should return failure if getAllMediaItems fails', async () => {
            const album1 = { id: 'album1', title: 'Album' };
            googlePhotosApi.getAllAlbums.mockResolvedValue([album1]);
            googlePhotosApi.getAlbumMediaItems.mockResolvedValue([]); // Album processed ok
            const error = new Error('API Error');
            googlePhotosApi.getAllMediaItems.mockRejectedValue(error); // Main stream fetch fails

            const result = await runInitialSync(mockAuth, mockDir, mockLogger);

            expect(downloader.ensureDirectoryExists).toHaveBeenCalledTimes(2); // Root + Album
            expect(downloader.downloadMediaItem).not.toHaveBeenCalled(); // No items downloaded
            expect(mockLogger.error).toHaveBeenCalledWith(`Initial synchronization failed critically: ${error.message}`);
            // Fix expected albumsProcessed count in this error case
            expect(result).toEqual({ success: false, albumsProcessed: 0, itemsProcessed: 0, itemsDownloaded: 0, itemsFailed: 0 });
        });
    });
}); 