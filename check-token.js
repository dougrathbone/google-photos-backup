#!/usr/bin/env node

/**
 * Token Inspector - Check what scopes are actually granted
 */

const fs = require('fs').promises;
const { google } = require('googleapis');

async function inspectToken() {
    console.log('🔍 Token Inspector');
    console.log('==================\n');
    
    try {
        const content = await fs.readFile('./data/sync_state.json');
        const credentials = JSON.parse(content);
        
        console.log('📄 Raw token data:');
        console.log(JSON.stringify(credentials, null, 2));
        
        const authClient = google.auth.fromJSON(credentials);
        const tokenInfo = await authClient.getAccessToken();
        
        console.log('\n🔑 Access token info:');
        console.log(`Token (first 30 chars): ${tokenInfo.token.substring(0, 30)}...`);
        console.log(`Token length: ${tokenInfo.token.length} characters`);
        
        // Check token info via Google's tokeninfo endpoint
        console.log('\n🔍 Checking token with Google tokeninfo API...');
        const tokenInfoResponse = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${tokenInfo.token}`);
        
        if (tokenInfoResponse.ok) {
            const tokenDetails = await tokenInfoResponse.json();
            console.log('✅ Token details from Google:');
            console.log(JSON.stringify(tokenDetails, null, 2));
        } else {
            console.log(`❌ Failed to get token info: ${tokenInfoResponse.status} ${tokenInfoResponse.statusText}`);
            const errorText = await tokenInfoResponse.text();
            console.log(`Error: ${errorText}`);
        }
        
    } catch (error) {
        console.log('❌ Error inspecting token:', error.message);
    }
}

if (require.main === module) {
    inspectToken().catch(console.error);
}

module.exports = { inspectToken }; 