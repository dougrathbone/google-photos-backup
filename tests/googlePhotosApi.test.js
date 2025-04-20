const Photos = require('googlephotos');
const { 
    getLatestMediaItem, 
    getAllMediaItems, 
    getAllAlbums, 
    getAlbumMediaItems,
    searchMediaItemsByDate
} = require('../src/googlePhotosApi');

// Mock the googlephotos library
jest.mock('googlephotos', () => {
    return jest.fn().mockImplementation((token) => {
        return {
            mediaItems: {
                list: jest.fn(),
                search: jest.fn(), // Add mock for search
            },
            albums: { // Add mock for albums
                list: jest.fn(),
            }
        };
    });
});

// Mock logger
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

const mockAccessToken = 'test-access-token';

describe('Google Photos API (using googlephotos library)', () => {
    const MockPhotos = Photos; 
    let photosInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        MockPhotos.mockClear();
        photosInstance = {
            mediaItems: {
                list: jest.fn(),
                search: jest.fn(),
            },
            albums: {
                list: jest.fn(),
            }
        };
        MockPhotos.mockImplementation(() => photosInstance);
    });

    describe('getLatestMediaItem', () => {
        test('should return the latest item successfully', async () => {
            const mockItem = {
                id: 'test-id',
                filename: 'latest.jpg',
                mediaMetadata: { creationTime: '2023-10-27T10:00:00Z' },
            };
            // Ensure the mock returns the expected structure
            photosInstance.mediaItems.list.mockResolvedValue({ mediaItems: [mockItem], nextPageToken: null });

            const latestItem = await getLatestMediaItem(mockAccessToken, mockLogger);

            expect(latestItem).toEqual(mockItem);
            expect(MockPhotos).toHaveBeenCalledWith(mockAccessToken);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(1); 
            expect(mockLogger.debug).toHaveBeenCalledWith('Attempting to fetch the latest media item using googlephotos library...');
            expect(mockLogger.debug).toHaveBeenCalledWith('Successfully fetched the latest media item via googlephotos.');
        });

        test('should return null if no items are found', async () => {
             photosInstance.mediaItems.list.mockResolvedValue({ mediaItems: [], nextPageToken: null });

            const latestItem = await getLatestMediaItem(mockAccessToken, mockLogger);

            expect(latestItem).toBeNull();
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(1);
            expect(mockLogger.info).toHaveBeenCalledWith('No media items found in the Google Photos library via googlephotos.');
        });
        
         test('should return null if response is missing mediaItems', async () => {
             // Simulate library potentially returning undefined or null for mediaItems
             photosInstance.mediaItems.list.mockResolvedValue({ nextPageToken: null });

            const latestItem = await getLatestMediaItem(mockAccessToken, mockLogger);

            expect(latestItem).toBeNull();
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(1);
            expect(mockLogger.info).toHaveBeenCalledWith('No media items found in the Google Photos library via googlephotos.');
        });

        test('should return null and log error on API failure', async () => {
            const apiError = new Error('API Call Failed');
            photosInstance.mediaItems.list.mockRejectedValue(apiError);

            const latestItem = await getLatestMediaItem(mockAccessToken, mockLogger);

            expect(latestItem).toBeNull();
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(1);
            expect(mockLogger.error).toHaveBeenCalledWith(`Error fetching latest media item via googlephotos: ${apiError.message}`);
        });
    });

    describe('getAllMediaItems', () => {
        test('should fetch all items across multiple pages', async () => {
            const item1 = { id: 'id1', filename: 'file1.jpg' };
            const item2 = { id: 'id2', filename: 'file2.jpg' };
            const item3 = { id: 'id3', filename: 'file3.jpg' };
            
            photosInstance.mediaItems.list
                .mockResolvedValueOnce({ mediaItems: [item1, item2], nextPageToken: 'token1' })
                .mockResolvedValueOnce({ mediaItems: [item3], nextPageToken: null });

            const allItems = await getAllMediaItems(mockAccessToken, mockLogger);

            expect(MockPhotos).toHaveBeenCalledWith(mockAccessToken);
            expect(allItems).toEqual([item1, item2, item3]);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledTimes(2);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(100, null);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(100, 'token1');
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Starting to fetch all media items'));
            expect(mockLogger.info).toHaveBeenCalledWith('Fetched 2 items on page 1.');
            expect(mockLogger.info).toHaveBeenCalledWith('Fetched 1 items on page 2.');
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Finished fetching media items. Total items found: 3'));
        });

        test('should return empty array if library is empty', async () => {
            photosInstance.mediaItems.list.mockResolvedValue({ mediaItems: [], nextPageToken: null });

            const allItems = await getAllMediaItems(mockAccessToken, mockLogger);

            expect(allItems).toEqual([]);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledTimes(1);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(100, null);
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No items found on page 1'));
             expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Finished fetching media items. Total items found: 0'));
        });
        
        test('should handle empty page response during pagination', async () => {
             const item1 = { id: 'id1', filename: 'file1.jpg' };
             photosInstance.mediaItems.list
                .mockResolvedValueOnce({ mediaItems: [item1], nextPageToken: 'token1' })
                .mockResolvedValueOnce({ mediaItems: [], nextPageToken: 'token2' }) // Empty page
                .mockResolvedValueOnce({ mediaItems: [], nextPageToken: null }); // Final empty page

            const allItems = await getAllMediaItems(mockAccessToken, mockLogger);

            expect(allItems).toEqual([item1]);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledTimes(3);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(100, null);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(100, 'token1');
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(100, 'token2');
            expect(mockLogger.info).toHaveBeenCalledWith('Fetched 1 items on page 1.');
            expect(mockLogger.info).toHaveBeenCalledWith('No items found on page 2.');
            expect(mockLogger.info).toHaveBeenCalledWith('No items found on page 3.');
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Finished fetching media items. Total items found: 1'));
        });

        test('should throw error on critical API failure during pagination', async () => {
             const item1 = { id: 'id1', filename: 'file1.jpg' };
             const apiError = new Error('Rate Limit Exceeded');
             
            photosInstance.mediaItems.list
                .mockResolvedValueOnce({ mediaItems: [item1], nextPageToken: 'token1' })
                .mockRejectedValueOnce(apiError);

            await expect(getAllMediaItems(mockAccessToken, mockLogger))
                .rejects.toThrow(`Failed to fetch all media items: ${apiError.message}`);

            expect(photosInstance.mediaItems.list).toHaveBeenCalledTimes(2);
             expect(mockLogger.error).toHaveBeenCalledWith(`Error fetching media items (page 2) via googlephotos: ${apiError.message}`);
        });

        test('should stop fetching after maxPages if specified', async () => {
            const item1 = { id: 'id1', filename: 'file1.jpg' };
            const item2 = { id: 'id2', filename: 'file2.jpg' };
            photosInstance.mediaItems.list
                .mockResolvedValueOnce({ mediaItems: [item1], nextPageToken: 'token1' }) // Page 1
                .mockResolvedValueOnce({ mediaItems: [item2], nextPageToken: 'token2' }); // Page 2 (shouldn't be fetched)

            const maxPages = 1;
            const allItems = await getAllMediaItems(mockAccessToken, mockLogger, maxPages);

            expect(allItems).toEqual([item1]); // Only item from page 1
            expect(photosInstance.mediaItems.list).toHaveBeenCalledTimes(1); // Called only once
            expect(photosInstance.mediaItems.list).toHaveBeenCalledWith(100, null);
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining(`Reached debug page limit (${maxPages}) for media items`));
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Finished fetching media items. Total items found: 1'));
        });
         test('should fetch all pages if maxPages is 0', async () => {
            const item1 = { id: 'id1' };
            const item2 = { id: 'id2' };
            photosInstance.mediaItems.list
                .mockResolvedValueOnce({ mediaItems: [item1], nextPageToken: 'token1' })
                .mockResolvedValueOnce({ mediaItems: [item2], nextPageToken: null });

            const allItems = await getAllMediaItems(mockAccessToken, mockLogger, 0);
            expect(allItems).toEqual([item1, item2]);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledTimes(2);
            expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Reached debug page limit'));
        });

        test('should fetch all pages if maxPages is not provided', async () => {
            const item1 = { id: 'id1' };
            const item2 = { id: 'id2' };
            photosInstance.mediaItems.list
                .mockResolvedValueOnce({ mediaItems: [item1], nextPageToken: 'token1' })
                .mockResolvedValueOnce({ mediaItems: [item2], nextPageToken: null });

            const allItems = await getAllMediaItems(mockAccessToken, mockLogger); // No maxPages arg
            expect(allItems).toEqual([item1, item2]);
            expect(photosInstance.mediaItems.list).toHaveBeenCalledTimes(2);
            expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Reached debug page limit'));
        });
    });

    describe('getAllAlbums', () => {
        test('should fetch all albums across multiple pages', async () => {
            const album1 = { id: 'album1', title: 'Trip' };
            const album2 = { id: 'album2', title: 'Pets' };
            photosInstance.albums.list
                .mockResolvedValueOnce({ albums: [album1], nextPageToken: 'tokenA' })
                .mockResolvedValueOnce({ albums: [album2], nextPageToken: null });

            const allAlbums = await getAllAlbums(mockAccessToken, mockLogger);

            expect(MockPhotos).toHaveBeenCalledWith(mockAccessToken);
            expect(allAlbums).toEqual([album1, album2]);
            expect(photosInstance.albums.list).toHaveBeenCalledTimes(2);
            expect(photosInstance.albums.list).toHaveBeenCalledWith(50, null); // Default page size
            expect(photosInstance.albums.list).toHaveBeenCalledWith(50, 'tokenA');
        });
        
        test('should return empty array if no albums', async () => {
            photosInstance.albums.list.mockResolvedValue({ albums: [], nextPageToken: null });
            const allAlbums = await getAllAlbums(mockAccessToken, mockLogger);
            expect(allAlbums).toEqual([]);
            expect(photosInstance.albums.list).toHaveBeenCalledTimes(1);
        });

        test('should throw error on API failure', async () => {
            const apiError = new Error('Albums API Failed');
            photosInstance.albums.list.mockRejectedValue(apiError);
            await expect(getAllAlbums(mockAccessToken, mockLogger))
                .rejects.toThrow(`Failed to fetch all albums: ${apiError.message}`);
        });

        test('should stop fetching after maxPages if specified', async () => {
            const album1 = { id: 'album1', title: 'Trip' };
            const album2 = { id: 'album2', title: 'Pets' };
            photosInstance.albums.list
                .mockResolvedValueOnce({ albums: [album1], nextPageToken: 'tokenA' })
                .mockResolvedValueOnce({ albums: [album2], nextPageToken: 'tokenB' }); // Page 2 (shouldn't be fetched)

            const maxPages = 1;
            const allAlbums = await getAllAlbums(mockAccessToken, mockLogger, maxPages);

            expect(allAlbums).toEqual([album1]);
            expect(photosInstance.albums.list).toHaveBeenCalledTimes(1);
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining(`Reached debug page limit (${maxPages}) for albums`));
        });
    });
    
    describe('getAlbumMediaItems', () => {
        const albumId = 'test-album-id';
        test('should search for items in an album across pages', async () => {
            const item1 = { id: 'idA', filename: 'fileA.jpg' };
            const item2 = { id: 'idB', filename: 'fileB.jpg' };
            photosInstance.mediaItems.search
                .mockResolvedValueOnce({ mediaItems: [item1], nextPageToken: 'tokenM' })
                .mockResolvedValueOnce({ mediaItems: [item2], nextPageToken: null });

            const albumItems = await getAlbumMediaItems(albumId, mockAccessToken, mockLogger);

            expect(MockPhotos).toHaveBeenCalledWith(mockAccessToken);
            expect(albumItems).toEqual([item1, item2]);
            expect(photosInstance.mediaItems.search).toHaveBeenCalledTimes(2);
            // Assuming library takes albumId, pageSize, pageToken
            expect(photosInstance.mediaItems.search).toHaveBeenCalledWith(albumId, 100, null); 
            expect(photosInstance.mediaItems.search).toHaveBeenCalledWith(albumId, 100, 'tokenM');
        });
        
        test('should return empty array if album is empty', async () => {
            photosInstance.mediaItems.search.mockResolvedValue({ mediaItems: [], nextPageToken: null });
            const albumItems = await getAlbumMediaItems(albumId, mockAccessToken, mockLogger);
            expect(albumItems).toEqual([]);
            expect(photosInstance.mediaItems.search).toHaveBeenCalledTimes(1);
        });

        test('should throw error on API failure', async () => {
            const apiError = new Error('Search API Failed');
            photosInstance.mediaItems.search.mockRejectedValue(apiError);
            await expect(getAlbumMediaItems(albumId, mockAccessToken, mockLogger))
                .rejects.toThrow(`Failed to fetch items for album ${albumId}: ${apiError.message}`);
        });

        test('should stop fetching after maxPages if specified', async () => {
            const item1 = { id: 'idA', filename: 'fileA.jpg' };
            const item2 = { id: 'idB', filename: 'fileB.jpg' };
            photosInstance.mediaItems.search
                .mockResolvedValueOnce({ mediaItems: [item1], nextPageToken: 'tokenM' })
                .mockResolvedValueOnce({ mediaItems: [item2], nextPageToken: 'tokenN' }); // Page 2 - shouldn't be called

            const maxPages = 1;
            const albumItems = await getAlbumMediaItems(albumId, mockAccessToken, mockLogger, maxPages);

            expect(albumItems).toEqual([item1]);
            expect(photosInstance.mediaItems.search).toHaveBeenCalledTimes(1);
            expect(photosInstance.mediaItems.search).toHaveBeenCalledWith(albumId, 100, null);
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining(`Reached debug page limit (${maxPages}) for album ${albumId}`));
        });
        
        test('should fetch all pages if maxPages is 0', async () => {
            const item1 = { id: 'idA' };
            const item2 = { id: 'idB' };
             photosInstance.mediaItems.search
                .mockResolvedValueOnce({ mediaItems: [item1], nextPageToken: 'tokenM' })
                .mockResolvedValueOnce({ mediaItems: [item2], nextPageToken: null });
            
            let albumItems = await getAlbumMediaItems(albumId, mockAccessToken, mockLogger, 0);
            expect(albumItems).toEqual([item1, item2]);
            expect(photosInstance.mediaItems.search).toHaveBeenCalledTimes(2);
            expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Reached debug page limit'));
        });

        test('should fetch all pages if maxPages is not provided', async () => {
            const item1 = { id: 'idA' };
            const item2 = { id: 'idB' };
             photosInstance.mediaItems.search
                .mockResolvedValueOnce({ mediaItems: [item1], nextPageToken: 'tokenM' })
                .mockResolvedValueOnce({ mediaItems: [item2], nextPageToken: null });

             const albumItems = await getAlbumMediaItems(albumId, mockAccessToken, mockLogger); // No maxPages arg
             expect(albumItems).toEqual([item1, item2]);
             expect(photosInstance.mediaItems.search).toHaveBeenCalledTimes(2);
             expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Reached debug page limit'));
         });
    });

    describe('searchMediaItemsByDate', () => {
        const startDate = '2024-01-15T10:00:00.000Z';
        const endDate = '2024-01-15T12:00:00.000Z';
        const expectedFilter = {
             dateFilter: { 
                 ranges: [ 
                     { 
                         startDate: { year: 2024, month: 1, day: 15 }, 
                         endDate: { year: 2024, month: 1, day: 15 } 
                     } 
                 ]
             }
         };

        test('should search using correct date filter and handle pagination', async () => {
            const item1 = { id: 'id1', mediaMetadata: { creationTime: '2024-01-15T10:30:00Z' } }; // In range
            const item2 = { id: 'id2', mediaMetadata: { creationTime: '2024-01-15T11:59:59Z' } }; // In range
            const item3 = { id: 'id3', mediaMetadata: { creationTime: '2024-01-15T12:00:00Z' } }; // In range (inclusive end)
            
            photosInstance.mediaItems.search
                .mockResolvedValueOnce({ mediaItems: [item1, item2], nextPageToken: 'tokenS' })
                .mockResolvedValueOnce({ mediaItems: [item3], nextPageToken: null });
            
            const results = await searchMediaItemsByDate(startDate, endDate, mockAccessToken, mockLogger);

            expect(results).toEqual([item1, item2, item3]);
            expect(photosInstance.mediaItems.search).toHaveBeenCalledTimes(2);
            expect(photosInstance.mediaItems.search).toHaveBeenCalledWith(expectedFilter, 100, null);
            expect(photosInstance.mediaItems.search).toHaveBeenCalledWith(expectedFilter, 100, 'tokenS');
        });

        test('should perform client-side filtering for precise time range', async () => {
            const itemBefore = { id: 'id0', mediaMetadata: { creationTime: '2024-01-15T09:59:59Z' } }; // Before range
            const itemStart = { id: 'id1', mediaMetadata: { creationTime: '2024-01-15T10:00:00Z' } }; // Equal to start (excluded)
            const itemMid = { id: 'id2', mediaMetadata: { creationTime: '2024-01-15T11:00:00Z' } }; // In range
            const itemEnd = { id: 'id3', mediaMetadata: { creationTime: '2024-01-15T12:00:00Z' } }; // Equal to end (included)
            const itemAfter = { id: 'id4', mediaMetadata: { creationTime: '2024-01-15T12:00:01Z' } }; // After range

            // Assume API returns items potentially outside the precise time due to day-based filtering
            photosInstance.mediaItems.search.mockResolvedValue({ mediaItems: [itemBefore, itemStart, itemMid, itemEnd, itemAfter], nextPageToken: null });
            
            const results = await searchMediaItemsByDate(startDate, endDate, mockAccessToken, mockLogger);

            // Only items strictly between start (exclusive) and end (inclusive) should remain
            expect(results).toEqual([itemMid, itemEnd]);
            expect(photosInstance.mediaItems.search).toHaveBeenCalledTimes(1);
            expect(photosInstance.mediaItems.search).toHaveBeenCalledWith(expectedFilter, 100, null);
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Fetched 5 items on page 1, 2 within precise date range'));
        });

        test('should return empty array if search yields no results', async () => {
            photosInstance.mediaItems.search.mockResolvedValue({ mediaItems: [], nextPageToken: null });
            const results = await searchMediaItemsByDate(startDate, endDate, mockAccessToken, mockLogger);
            expect(results).toEqual([]);
        });

         test('should throw error on API failure', async () => {
             const apiError = new Error('Search Failed');
             photosInstance.mediaItems.search.mockRejectedValue(apiError);
             await expect(searchMediaItemsByDate(startDate, endDate, mockAccessToken, mockLogger))
                 .rejects.toThrow(`Failed to search media items by date: ${apiError.message}`);
         });
    });
}); 