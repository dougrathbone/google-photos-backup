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

// fs mocks
const mockFsReadFile = jest.fn();
const mockFsWriteFile = jest.fn();
const mockFsChmod = jest.fn();
const mockFsReaddir = jest.fn(); // For compatibility if fileUtils runs
const mockFsStat = jest.fn(); // For compatibility if fileUtils runs

// readline mocks (defined inside factory below)

// --- Apply Mocks --- 

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

jest.mock('fs', () => ({
    promises: {
        readFile: mockFsReadFile,
        writeFile: mockFsWriteFile,
        chmod: mockFsChmod,
        readdir: mockFsReaddir, 
        stat: mockFsStat, 
    },
    // Keep non-promise mocks if needed by other tests
    existsSync: jest.requireActual('fs').existsSync, 
    readFileSync: jest.requireActual('fs').readFileSync,
}));

jest.mock('open', () => jest.fn());

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

const fs = require('fs').promises; // Now require fs AFTER mock is applied
const { google } = require('googleapis');
const open = require('open');
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
        
        // Reset mocks using the pre-defined variables
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockReset();
        readlineMock.__mockReadlineClose.mockReset();
        
        mockFsReadFile.mockReset();
        mockFsWriteFile.mockReset();
        mockFsChmod.mockReset();

        mockFromJSON.mockReset();
        mockGenerateAuthUrl.mockReset();
        mockGetToken.mockReset();
        mockSetCredentials.mockReset();
        
        require('open').mockClear(); 
    });

    // --- Tests --- 

    test('should load existing token successfully', async () => {
        const mockAuthClient = { /* represents loaded client */ };
        mockFsReadFile.mockResolvedValueOnce(JSON.stringify(mockTokenContent)); // Use mockFsReadFile
        mockFromJSON.mockReturnValueOnce(mockAuthClient);

        const client = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);

        expect(client).toBe(mockAuthClient);
        expect(mockFsReadFile).toHaveBeenCalledWith(mockTokenPath); // Check mockFsReadFile
        expect(mockFromJSON).toHaveBeenCalledWith(mockTokenContent);
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Successfully loaded existing token'));
        expect(mockFsReadFile).toHaveBeenCalledTimes(1); // Check mockFsReadFile
        expect(mockOAuth2).not.toHaveBeenCalled();
    });

    test('should start auth flow if token file does not exist', async () => {
        const error = new Error('ENOENT');
        error.code = 'ENOENT';
        mockFsReadFile.mockRejectedValueOnce(error); // Use mockFsReadFile
        mockFsReadFile.mockResolvedValueOnce(JSON.stringify(mockClientSecretsContent)); // Use mockFsReadFile
        mockGenerateAuthUrl.mockReturnValue('http://fakeauth.url');
        
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockImplementation((query, callback) => callback('test-code '));
        
        mockGetToken.mockResolvedValue({ tokens: { access_token: 'new-access-token' } });
        const mockNewAuthClient = mockOAuth2(); 
        mockNewAuthClient.getToken = mockGetToken; 

        const client = await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);

        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Token file not found'));
        expect(mockFsReadFile).toHaveBeenCalledWith(mockClientSecretsPath); // Check mockFsReadFile
        expect(mockOAuth2).toHaveBeenCalledWith('test-client-id', 'test-client-secret', 'urn:ietf:wg:oauth:2.0:oob');
        expect(mockGenerateAuthUrl).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Authorize this app'));
        expect(require('open')).toHaveBeenCalledWith('http://fakeauth.url');
        expect(readlineMock.__mockReadlineQuestion).toHaveBeenCalled();
        expect(mockGetToken).toHaveBeenCalledWith('test-code');
        expect(mockSetCredentials).toHaveBeenCalledWith({ access_token: 'new-access-token' });
        expect(mockFsWriteFile).toHaveBeenCalled(); // Check mockFsWriteFile
        expect(mockFsChmod).toHaveBeenCalledWith(mockTokenPath, 0o600); // Check mockFsChmod
        expect(client).toEqual(mockNewAuthClient);
    });

    // ... Update other tests similarly to use mockFsReadFile, mockFsWriteFile, mockFsChmod ...

    test('should throw error if client secrets file cannot be read', async () => {
        mockFsReadFile.mockRejectedValueOnce({ code: 'ENOENT' }); // Token not found
        const secretsError = new Error('Cannot read secrets');
        mockFsReadFile.mockRejectedValueOnce(secretsError); // Secrets read fails

        await expect(authorize(mockClientSecretsPath, mockTokenPath, mockLogger))
            .rejects.toThrow(`Missing or unreadable client secret file: ${mockClientSecretsPath}`);

        expect(mockFsReadFile).toHaveBeenCalledWith(mockTokenPath);
        expect(mockFsReadFile).toHaveBeenCalledWith(mockClientSecretsPath);
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error loading client secret file'), secretsError);
    });

    test('should throw error if client secrets file has invalid format', async () => {
        mockFsReadFile.mockRejectedValueOnce({ code: 'ENOENT' }); // Token not found
        mockFsReadFile.mockResolvedValueOnce(JSON.stringify({ invalid: 'format' })); // Bad secrets format

        await expect(authorize(mockClientSecretsPath, mockTokenPath, mockLogger))
            .rejects.toThrow('Invalid client secret file format');
    });

    test('should throw error if getting token fails', async () => {
        mockFsReadFile.mockRejectedValueOnce({ code: 'ENOENT' }); // Token not found
        mockFsReadFile.mockResolvedValueOnce(JSON.stringify(mockClientSecretsContent));
        mockGenerateAuthUrl.mockReturnValue('http://fakeauth.url');
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockImplementation((query, callback) => callback('test-code'));
        const tokenError = new Error('Invalid code');
        mockGetToken.mockRejectedValue(tokenError);
        mockOAuth2(); 

        await expect(authorize(mockClientSecretsPath, mockTokenPath, mockLogger))
            .rejects.toThrow(`Failed to get or save token: ${tokenError.message}`);

        expect(mockLogger.error).toHaveBeenCalledWith('Error retrieving or saving access token:', tokenError);
        expect(mockFsWriteFile).not.toHaveBeenCalled(); 
    });

    test('should throw error if saving token fails', async () => {
        mockFsReadFile.mockRejectedValueOnce({ code: 'ENOENT' }); // Token not found
        mockFsReadFile.mockResolvedValueOnce(JSON.stringify(mockClientSecretsContent));
        mockGenerateAuthUrl.mockReturnValue('http://fakeauth.url');
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockImplementation((query, callback) => callback('test-code'));
        mockGetToken.mockResolvedValue({ tokens: { access_token: 'new-access-token' } });
        const saveError = new Error('Disk full');
        mockFsWriteFile.mockRejectedValueOnce(saveError);
        mockOAuth2(); 

        await expect(authorize(mockClientSecretsPath, mockTokenPath, mockLogger))
            .rejects.toThrow(`Failed to save token: ${saveError.message}`);

        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error saving token'), saveError);
    });

     test('should handle open failure gracefully', async () => {
        mockFsReadFile.mockRejectedValueOnce({ code: 'ENOENT' }); 
        mockFsReadFile.mockResolvedValueOnce(JSON.stringify(mockClientSecretsContent));
        mockGenerateAuthUrl.mockReturnValue('http://fakeauth.url');
        require('open').mockRejectedValueOnce(new Error('Browser not found'));
        const readlineMock = require('readline');
        readlineMock.__mockReadlineQuestion.mockImplementation((query, callback) => callback('test-code'));
        mockGetToken.mockResolvedValue({ tokens: { access_token: 'new-access-token' } });
        mockOAuth2(); 

        await authorize(mockClientSecretsPath, mockTokenPath, mockLogger);

        expect(require('open')).toHaveBeenCalledWith('http://fakeauth.url');
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to automatically open browser'));
        expect(readlineMock.__mockReadlineQuestion).toHaveBeenCalled(); 
    });
});
