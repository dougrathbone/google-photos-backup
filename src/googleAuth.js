const fs = require('fs').promises; // Use promises for async/await
const path = require('path');
const process = require('process');
// const { authenticate } = require('@google-cloud/local-auth'); // Removed unused import
const { google } = require('googleapis');
const open = require('open');
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
        rl.question('Enter the authorization code from that page here: ', (code) => {
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
 * @returns {Promise<OAuth2Client>} An authorized OAuth2 client.
 */
async function authorize(clientSecretsPath, tokenPath, logger) {
    logger.info('Attempting to authorize Google Photos API access...');
    let client = await loadTokenIfExists(tokenPath, logger);
    if (client) {
        logger.info('Successfully loaded existing token.');
        // TODO: Add check for token expiry and refresh if needed (googleapis might handle this automatically)
        return client;
    }

    // If no valid token, start the OAuth flow
    logger.info('No valid token found, starting new authorization flow.');
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

    logger.info(`Authorize this app by visiting this url: ${authUrl}`);
    try {
        await open(authUrl);
        logger.info('Opened authorization URL in your default browser.');
    } catch (err) {
        logger.warn(`Failed to automatically open browser: ${err.message}. Please open the URL manually.`);
    }

    const code = await getCodeFromTerminal();
    logger.info(`Received authorization code.`);

    try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        logger.info('Successfully exchanged code for tokens.');
        await saveToken(tokenPath, oAuth2Client, logger);
        return oAuth2Client;
    } catch (err) {
        logger.error('Error retrieving or saving access token:', err);
        throw new Error(`Failed to get or save token: ${err.message}`);
    }
}

module.exports = { authorize }; 