const { google } = require('googleapis');
const { getLatestMediaItem } = require('../src/googlePhotosApi');

// Mock googleapis
const mockMediaItemsList = jest.fn();
jest.mock('googleapis', () => ({
    google: {
        // Mock the function call 'google.photoslibrary('v1')'
        photoslibrary: jest.fn(() => ({
            mediaItems: {
                list: mockMediaItemsList,
            },
        })),
        // Include auth setup needed by googleAuth tests if run together
        auth: {
            fromJSON: jest.fn(),
            OAuth2: jest.fn().mockImplementation(() => ({
                generateAuthUrl: jest.fn(),
                getToken: jest.fn(),
                setCredentials: jest.fn(),
                _clientId: 'test-client-id',
                _clientSecret: 'test-client-secret',
                credentials: { refresh_token: 'test-refresh-token' },
            })),
        }
    },
}));

// Mock logger
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

// Mock auth client
const mockAuthClient = { /* Just needs to be an object */ };

describe('Google Photos API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mock implementation for list
        mockMediaItemsList.mockReset();
    });

    test('getLatestMediaItem should return the latest item successfully', async () => {
        const mockItem = {
            id: 'test-id',
            filename: 'latest.jpg',
            mediaMetadata: { creationTime: '2023-10-27T10:00:00Z' },
        };
        mockMediaItemsList.mockResolvedValue({ data: { mediaItems: [mockItem] } });

        const latestItem = await getLatestMediaItem(mockAuthClient, mockLogger);

        expect(latestItem).toEqual(mockItem);
        expect(google.photoslibrary).toHaveBeenCalledWith('v1');
        expect(mockMediaItemsList).toHaveBeenCalledWith({
            pageSize: 1,
            auth: mockAuthClient,
        });
        expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Attempting to fetch'));
        expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Successfully fetched'));
    });

    test('getLatestMediaItem should return null if no items are found', async () => {
        mockMediaItemsList.mockResolvedValue({ data: { mediaItems: [] } }); // Empty array

        const latestItem = await getLatestMediaItem(mockAuthClient, mockLogger);

        expect(latestItem).toBeNull();
        expect(mockMediaItemsList).toHaveBeenCalledWith({ pageSize: 1, auth: mockAuthClient });
        expect(mockLogger.info).toHaveBeenCalledWith('No media items found in the Google Photos library.');
    });

    test('getLatestMediaItem should return null if API response has no mediaItems property', async () => {
        mockMediaItemsList.mockResolvedValue({ data: {} }); // No mediaItems property

        const latestItem = await getLatestMediaItem(mockAuthClient, mockLogger);

        expect(latestItem).toBeNull();
        expect(mockMediaItemsList).toHaveBeenCalledWith({ pageSize: 1, auth: mockAuthClient });
        expect(mockLogger.info).toHaveBeenCalledWith('No media items found in the Google Photos library.');
    });

    test('getLatestMediaItem should return null and log error on API failure', async () => {
        const apiError = new Error('API Error');
        mockMediaItemsList.mockRejectedValue(apiError);

        const latestItem = await getLatestMediaItem(mockAuthClient, mockLogger);

        expect(latestItem).toBeNull();
        expect(mockMediaItemsList).toHaveBeenCalledWith({ pageSize: 1, auth: mockAuthClient });
        expect(mockLogger.error).toHaveBeenCalledWith(`Error fetching latest media item from Google Photos API: ${apiError.message}`);
    });

    test('getLatestMediaItem should log detailed API error if available', async () => {
        const apiError = new Error('Permission Denied');
        apiError.response = { data: { error: { code: 403, message: 'Forbidden' } } };
        mockMediaItemsList.mockRejectedValue(apiError);

        await getLatestMediaItem(mockAuthClient, mockLogger);

        expect(mockLogger.error).toHaveBeenCalledWith(`Error fetching latest media item from Google Photos API: ${apiError.message}`);
        expect(mockLogger.error).toHaveBeenCalledWith('API Error Details:', apiError.response.data.error);
    });
}); 