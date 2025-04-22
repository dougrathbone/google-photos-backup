const fs = require('fs').promises; // Use promises for async/await
const path = require('path');
const process = require('process');
// const { authenticate } = require('@google-cloud/local-auth'); // Removed unused import
const { google } = require('googleapis');
// const open = require('open'); // Removed library
const readline = require('readline');

// If modifying these scopes, delete token.json.
// Readonly scope is sufficient for backup/sync download
const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly'];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time. The path comes from config.
// const TOKEN_PATH = path.join(process.cwd(), 'token.json'); // We'll get this from config

// The client secrets file needs to be obtained from Google Cloud Console.
// The path comes from config.
// const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json'); // We'll get this from config

/**
 * Reads previously authorized credentials from the save file.
 * @param {string} tokenPath The path to the token file.
 * @param {winston.Logger} logger The logger instance.
 * @returns {Promise<OAuth2Client|null>}
 */
async function loadTokenIfExists(tokenPath, logger) {
    try {
        const content = await fs.readFile(tokenPath);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.info(`Token file not found at ${tokenPath}. Will need to authenticate.`);
        } else {
            logger.error(`Error loading token from ${tokenPath}:`, err);
        }
        return null;
    }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 * @param {string} tokenPath The path to save the token file.
 * @param {OAuth2Client} client The authenticated client.
 * @param {winston.Logger} logger The logger instance.
 * @returns {Promise<void>}
 */
async function saveToken(tokenPath, client, logger) {
    try {
        const payload = JSON.stringify({
            type: 'authorized_user',
            client_id: client._clientId,
            client_secret: client._clientSecret,
            refresh_token: client.credentials.refresh_token,
        });
        await fs.writeFile(tokenPath, payload);
        // It's crucial to restrict permissions on the token file
        await fs.chmod(tokenPath, 0o600);
        logger.info(`Token stored to ${tokenPath}`);
    } catch (err) {
        logger.error(`Error saving token to ${tokenPath}:`, err);
        throw new Error(`Failed to save token: ${err.message}`); // Re-throw for main flow
    }
}

/**
 * Prompts the user for the authorization code from the browser.
 * @returns {Promise<string>} The authorization code entered by the user.
 */
function getCodeFromTerminal() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        // Add extra newline for clarity
        rl.question('\nEnter the authorization code from that page here: ', (code) => {
            rl.close();
            resolve(code.trim());
        });
    });
}


/**
 * Load or request authorization to call APIs.
 * Manages loading/saving the token.
 * @param {string} clientSecretsPath Path to the client_secret.json file.
 * @param {string} tokenPath Path to store/load the token file.
 * @param {winston.Logger} logger The logger instance.
 * @returns {Promise<{client: OAuth2Client, accessToken: string}|null>} An object containing the authorized client and the access token, or null on failure.
 */
async function authorize(clientSecretsPath, tokenPath, logger) {
    logger.info('Attempting to authorize Google Photos API access...');
    try {
        let client = await loadTokenIfExists(tokenPath, logger);
        if (client) {
            logger.info('Successfully loaded existing token.');
            // Ensure credentials (like access_token) are available
            // google-auth-library might refresh automatically, but let's try to get it
             try {
                 const tokenInfo = await client.getAccessToken();
                 if (!tokenInfo || !tokenInfo.token) {
                     logger.warn('Could not retrieve access token from loaded client, attempting refresh flow.');
                     // Force refresh flow by setting client to null
                     client = null; 
                 } else {
                     logger.debug('Access token retrieved successfully from existing client.');
                     return { client, accessToken: tokenInfo.token };
                 }
             } catch (refreshError) {
                 logger.warn(`Failed to get/refresh access token from loaded client: ${refreshError.message}. Proceeding with new authorization flow.`);
                 client = null; // Force refresh flow
             }
        }

        // If no valid token or refresh failed, start the OAuth flow
        logger.info('No valid token found or refresh failed, starting new authorization flow.');
        let secretsContent;
        try {
            secretsContent = await fs.readFile(clientSecretsPath);
        } catch (err) {
            logger.error(`Error loading client secret file from ${clientSecretsPath}:`, err);
            logger.error('Please ensure you have downloaded your OAuth 2.0 Client credentials (client_secret.json) from the Google Cloud Console and placed it correctly.');
            throw new Error(`Missing or unreadable client secret file: ${clientSecretsPath}`);
        }

        const keys = JSON.parse(secretsContent);
        const key = keys.installed || keys.web; // Support both types
         if (!key) {
             throw new Error('Invalid client secret file format: Missing "installed" or "web" key.');
         }

        const oAuth2Client = new google.auth.OAuth2(
            key.client_id,
            key.client_secret,
            key.redirect_uris ? key.redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob' // Use OOB for non-web apps if no redirect URI specified
        );

        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline', // Request refresh token
            scope: SCOPES,
            prompt: 'consent', // Ensure user sees consent screen even if previously authorized
        });

        // Log the URL clearly for the user
        logger.info('Authorize this app by visiting this url:');
        logger.info(authUrl);
        console.log('\n--------------------------------------------------------------------------------');
        console.log('Please open the following URL in your browser to authorize the application:');
        console.log(authUrl);
        logger.info(`Authorize this app by visiting this url: ${authUrl}`);
        try {
            await open(authUrl);
            logger.info('Opened authorization URL in your default browser.');
        } catch (err) {
            logger.warn(`Failed to automatically open browser: ${err.message}. Please open the URL manually.`);
        }

        const code = await getCodeFromTerminal();
        logger.info(`Received authorization code.`);

        // Rename the existing oAuth2Client variable for clarity
        const newOAuth2Client = oAuth2Client; 

        const { tokens } = await newOAuth2Client.getToken(code);
        newOAuth2Client.setCredentials(tokens);
        logger.info('Successfully exchanged code for tokens.');
        
        // Ensure we have an access token after exchange
        if (!tokens.access_token) {
            logger.error('Failed to obtain access_token after code exchange.');
            throw new Error('Access token missing in returned tokens.');
        }
        
        await saveToken(tokenPath, newOAuth2Client, logger);
        return { client: newOAuth2Client, accessToken: tokens.access_token };

    } catch (err) {
        // Catch errors from the entire process
        logger.error('Authorization process failed. Details:');
        // Log the full error object for more details (including potential stack trace)
        logger.error(err); 
        
        // Log specific known errors again for clarity if helpful
        if (err.message && err.message.includes('client secret file')) {
             logger.error('Double-check: Ensure client_secret.json exists, is readable by the service user, and contains valid JSON from Google Cloud Console.');
        }
        // Add check for token exchange errors (often indicate wrong code or client secret mismatch)
        if (err.response && err.response.data) {
             logger.error('Google API Error Response:', err.response.data);
        }

        return null; // Indicate failure
    }
}

module.exports = { authorize }; 