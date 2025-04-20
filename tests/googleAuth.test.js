// --- Define Mocks First --- 

// googleapis mocks
const mockGenerateAuthUrl = jest.fn();
const mockGetToken = jest.fn();
const mockSetCredentials = jest.fn();
const mockFromJSON = jest.fn();
const mockOAuth2 = jest.fn().mockImplementation(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    setCredentials: mockSetCredentials,
    _clientId: 'mock-client-id',
    _clientSecret: 'mock-client-secret',
    credentials: { refresh_token: 'mock-refresh-token' },
}));
const mockPhotosList = jest.fn();

// fs mocks (Variables removed)
// const mockFsReadFile = jest.fn();
// const mockFsWriteFile = jest.fn();
// const mockFsChmod = jest.fn();
// const mockFsReaddir = jest.fn(); 
// const mockFsStat = jest.fn(); 

// readline mocks (defined inside factory below)

// --- Apply Mocks --- 

// Mock fs *before* requiring it
jest.mock('fs', () => ({
    promises: {
        // Define mocks directly in the factory
        readFile: jest.fn(),
        writeFile: jest.fn(),
        chmod: jest.fn(),
        readdir: jest.fn(), 
        stat: jest.fn(), 
    },
    existsSync: jest.requireActual('fs').existsSync, 
    readFileSync: jest.requireActual('fs').readFileSync,
}));

jest.mock('googleapis', () => ({
    google: {
        auth: {
            fromJSON: mockFromJSON,
            OAuth2: mockOAuth2,
        },
        photoslibrary: jest.fn(() => ({
            mediaItems: {
                list: mockPhotosList,
            },
        })),
    },
}));

// jest.mock('open', () => jest.fn()); // Remove open mock

jest.mock('readline', () => {
    const mockReadlineQuestion = jest.fn();
    const mockReadlineClose = jest.fn();
    return {
        __mockReadlineQuestion: mockReadlineQuestion, 
        __mockReadlineClose: mockReadlineClose,
        createInterface: jest.fn().mockReturnValue({
            question: mockReadlineQuestion,
            close: mockReadlineClose,
        }),
    };
});

// --- Require Modules --- 

const fs = require('fs').promises; // Require fs AFTER mock is applied
const { google } = require('googleapis');
// const open = require('open'); // Remove require
const readline = require('readline');
const { authorize } = require('../src/googleAuth');

// --- Mock Logger & Constants --- 

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

const mockClientSecretsPath = '/fake/secrets.json';
const mockTokenPath = '/fake/token.json';
const mockClientSecretsContent = {
    installed: {
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        redirect_uris: ['urn:ietf:wg:oauth:2.0:oob'],
    },
};
const mockTokenContent = {
    type: 'authorized_user',
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    refresh_token: 'test-refresh-token',
};

// --- Test Suite --- 

describe('Google Auth', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockReset();
        readlineMock.__mockReadlineClose.mockReset();
        
        // Reset fs mocks directly via the required module
        fs.readFile.mockReset();
        fs.writeFile.mockReset();
        fs.chmod.mockReset();

        mockFromJSON.mockReset();
        mockGenerateAuthUrl.mockReset();
        mockGetToken.mockReset();
        mockSetCredentials.mockReset();
        
        // require('open').mockClear(); // Remove reset for open
    });

    // --- Tests --- 

    test('should load existing token successfully and return client and token', async () => {
        const mockAuthClient = {
            getAccessToken: jest.fn().mockResolvedValue({ token: 'existing-access-token' })
        };
        fs.readFile.mockResolvedValueOnce(JSON.stringify(mockTokenContent)); // Use fs.readFile directly
        mockFromJSON.mockReturnValueOnce(mockAuthClient);

        const result = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);

        expect(result).toBeDefined();
        expect(result.client).toBe(mockAuthClient);
        expect(result.accessToken).toBe('existing-access-token');
        expect(mockAuthClient.getAccessToken).toHaveBeenCalled();
        expect(fs.readFile).toHaveBeenCalledWith(mockTokenPath); // Check fs.readFile
        expect(mockFromJSON).toHaveBeenCalledWith(mockTokenContent);
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Successfully loaded existing token'));
        expect(mockLogger.debug).toHaveBeenCalledWith('Access token retrieved successfully from existing client.');
        expect(mockOAuth2).not.toHaveBeenCalled();
    });
    
    test('should attempt refresh flow if getAccessToken fails on existing client', async () => {
        const mockAuthClient = {
            getAccessToken: jest.fn().mockRejectedValue(new Error('Refresh failed'))
        };
        fs.readFile.mockResolvedValueOnce(JSON.stringify(mockTokenContent)); // Use fs.readFile
        mockFromJSON.mockReturnValueOnce(mockAuthClient);
        fs.readFile.mockResolvedValueOnce(JSON.stringify(mockClientSecretsContent)); // Use fs.readFile
        // Setup for new auth flow after refresh fails
        mockGenerateAuthUrl.mockReturnValue('http://fakeauth.url');
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockImplementation((query, callback) => callback('test-code '));
        mockGetToken.mockResolvedValue({ tokens: { access_token: 'new-access-token' } });
        const mockNewAuthClient = mockOAuth2();
        mockNewAuthClient.getToken = mockGetToken;

        const result = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);

        expect(mockAuthClient.getAccessToken).toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to get/refresh access token'));
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('starting new authorization flow'));
        // Check that the new auth flow completed
        expect(result).toBeDefined();
        expect(result.accessToken).toBe('new-access-token');
        expect(fs.writeFile).toHaveBeenCalled();
    });

    test('should start auth flow if token file does not exist and return client and token', async () => {
        const error = new Error('ENOENT');
        error.code = 'ENOENT';
        fs.readFile.mockRejectedValueOnce(error); // Use fs.readFile
        fs.readFile.mockResolvedValueOnce(JSON.stringify(mockClientSecretsContent)); // Use fs.readFile
        mockGenerateAuthUrl.mockReturnValue('http://fakeauth.url');
        
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockImplementation((query, callback) => callback('test-code '));
        
        const newToken = 'new-access-token';
        mockGetToken.mockResolvedValue({ tokens: { access_token: newToken, refresh_token: 'new-refresh' } }); // Ensure access_token is in tokens
        const mockNewAuthClient = mockOAuth2(); 
        mockNewAuthClient.getToken = mockGetToken; 

        const result = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);

        // Assertions for auth flow (mostly unchanged)
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Token file not found'));
        expect(fs.readFile).toHaveBeenCalledWith(mockClientSecretsPath);
        expect(mockOAuth2).toHaveBeenCalledWith('test-client-id', 'test-client-secret', 'urn:ietf:wg:oauth:2.0:oob');
        expect(mockGenerateAuthUrl).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Authorize this app by visiting'));
        expect(readlineMock.__mockReadlineQuestion).toHaveBeenCalled();
        expect(mockGetToken).toHaveBeenCalledWith('test-code');
        expect(mockSetCredentials).toHaveBeenCalledWith({ access_token: newToken, refresh_token: 'new-refresh' });
        expect(fs.writeFile).toHaveBeenCalled();
        expect(fs.chmod).toHaveBeenCalledWith(mockTokenPath, 0o600);
        
        // Check returned object
        expect(result).toBeDefined();
        expect(result.client).toEqual(mockNewAuthClient);
        expect(result.accessToken).toBe(newToken);
    });

    test('should return null if authorization fails critically', async () => {
        const secretsError = new Error('Cannot read secrets');
        fs.readFile.mockRejectedValueOnce({ code: 'ENOENT' }); // Token not found
        fs.readFile.mockRejectedValueOnce(secretsError); // Secrets read fails

        const result = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);
        
        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith('Authorization process failed:', expect.stringContaining('client secret file'));
    });

    test('should return null if getToken fails and does not save', async () => {
        fs.readFile.mockRejectedValueOnce({ code: 'ENOENT' }); 
        fs.readFile.mockResolvedValueOnce(JSON.stringify(mockClientSecretsContent));
        mockGenerateAuthUrl.mockReturnValue('http://fakeauth.url');
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockImplementation((query, callback) => callback('test-code'));
        const tokenError = new Error('Invalid code');
        mockGetToken.mockRejectedValue(tokenError);
        mockOAuth2();

        const result = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);
        
        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith('Authorization process failed:', tokenError.message);
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    test('should return null if client secrets file cannot be read', async () => {
        fs.readFile.mockRejectedValueOnce({ code: 'ENOENT' }); // Token not found
        const secretsError = new Error('Cannot read secrets');
        fs.readFile.mockRejectedValueOnce(secretsError); // Secrets read fails

        const result = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);
        expect(result).toBeNull();

        expect(fs.readFile).toHaveBeenCalledWith(mockTokenPath);
        expect(fs.readFile).toHaveBeenCalledWith(mockClientSecretsPath);
        expect(mockLogger.error).toHaveBeenCalledWith('Authorization process failed:', expect.stringContaining('client secret file'));
    });

    test('should return null if client secrets file has invalid format', async () => {
        fs.readFile.mockRejectedValueOnce({ code: 'ENOENT' }); // Token not found
        fs.readFile.mockResolvedValueOnce(JSON.stringify({ invalid: 'format' })); // Bad secrets format

        const result = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);
        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith('Authorization process failed:', 'Invalid client secret file format: Missing "installed" or "web" key.');
    });

    test('should return null if getting token fails', async () => {
        fs.readFile.mockRejectedValueOnce({ code: 'ENOENT' }); 
        fs.readFile.mockResolvedValueOnce(JSON.stringify(mockClientSecretsContent));
        mockGenerateAuthUrl.mockReturnValue('http://fakeauth.url');
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockImplementation((query, callback) => callback('test-code'));
        const tokenError = new Error('Invalid code');
        mockGetToken.mockRejectedValue(tokenError);
        mockOAuth2();

        const result = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);
        expect(result).toBeNull();

        expect(mockLogger.error).toHaveBeenCalledWith('Authorization process failed:', tokenError.message);
        expect(fs.writeFile).not.toHaveBeenCalled(); 
    });

    test('should return null if saving token fails', async () => {
        fs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });
        fs.readFile.mockResolvedValueOnce(JSON.stringify(mockClientSecretsContent));
        mockGenerateAuthUrl.mockReturnValue('http://fakeauth.url');
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockImplementation((query, callback) => callback('test-code'));
        mockGetToken.mockResolvedValue({ tokens: { access_token: 'new-access-token' } });
        const saveError = new Error('Disk full');
        fs.writeFile.mockRejectedValueOnce(saveError);
        mockOAuth2();

        const result = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);
        expect(result).toBeNull();

        expect(mockLogger.error).toHaveBeenCalledWith('Authorization process failed:', expect.stringContaining(saveError.message));
    });
});
