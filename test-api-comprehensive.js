#!/usr/bin/env node

/**
 * Comprehensive Google Photos API Test
 * Tests different scopes, libraries, and approaches
 */

const fs = require('fs').promises;
const { google } = require('googleapis');
const Photos = require('googlephotos');
const readline = require('readline');

// Different scope combinations to test
const SCOPE_TESTS = [
    {
        name: 'readonly (current)',
        scopes: ['https://www.googleapis.com/auth/photoslibrary.readonly']
    },
    {
        name: 'full access',
        scopes: ['https://www.googleapis.com/auth/photoslibrary']
    },
    {
        name: 'readonly + sharing',
        scopes: [
            'https://www.googleapis.com/auth/photoslibrary.readonly',
            'https://www.googleapis.com/auth/photoslibrary.sharing'
        ]
    },
    {
        name: 'appendonly',
        scopes: ['https://www.googleapis.com/auth/photoslibrary.appendonly']
    }
];

async function testDifferentScopes() {
    console.log('🔍 Testing Different OAuth Scopes');
    console.log('==================================\n');

    const clientSecretsPath = './client_credentials.json';
    
    for (const scopeTest of SCOPE_TESTS) {
        console.log(`\n--- Testing: ${scopeTest.name} ---`);
        console.log(`Scopes: ${scopeTest.scopes.join(', ')}`);
        
        try {
            // Create auth client with specific scopes
            const credentials = JSON.parse(await fs.readFile(clientSecretsPath));
            const { client_secret, client_id, redirect_uris } = credentials.installed;
            
            const oAuth2Client = new google.auth.OAuth2(
                client_id,
                client_secret,
                redirect_uris[0]
            );

            // Generate auth URL
            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: scopeTest.scopes,
                prompt: 'consent'
            });

            console.log(`\nTo test ${scopeTest.name}, visit:`);
            console.log(authUrl);
            console.log('\nEnter the auth code (or press Enter to skip):');
            
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const code = await new Promise(resolve => {
                rl.question('', answer => {
                    rl.close();
                    resolve(answer.trim());
                });
            });

            if (!code) {
                console.log('⏭️  Skipped');
                continue;
            }

            // Exchange code for tokens
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);

            console.log('✅ Authentication successful');

            // Test API calls
            await testAPICalls(oAuth2Client, tokens.access_token, scopeTest.name);

        } catch (error) {
            console.log(`❌ Error testing ${scopeTest.name}:`, error.message);
        }
    }
}

async function testAPICalls(authClient, accessToken, scopeName) {
    console.log(`\n🧪 Testing API calls with ${scopeName}:`);

    // Test 1: Try with direct HTTP requests
    try {
        const response = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=1', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('✅ Direct HTTP mediaItems.list succeeded');
            console.log(`   Found ${data.mediaItems?.length || 0} items`);
        } else {
            console.log(`❌ Direct HTTP mediaItems.list failed: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.log(`   Error: ${errorText}`);
        }
    } catch (error) {
        console.log('❌ Direct HTTP request failed:', error.message);
    }

    // Test 2: Try albums with direct HTTP
    try {
        const response = await fetch('https://photoslibrary.googleapis.com/v1/albums?pageSize=1', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('✅ Direct HTTP albums.list succeeded');
            console.log(`   Found ${data.albums?.length || 0} albums`);
        } else {
            console.log(`❌ Direct HTTP albums.list failed: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.log(`   Error: ${errorText}`);
        }
    } catch (error) {
        console.log('❌ Direct HTTP albums request failed:', error.message);
    }

    // Test 3: googlephotos library
    try {
        const photos = new Photos(accessToken);
        const response = await photos.mediaItems.list(1);
        console.log('✅ googlephotos mediaItems.list succeeded');
        console.log(`   Found ${response.mediaItems?.length || 0} items`);
    } catch (error) {
        console.log('❌ googlephotos mediaItems.list failed:', error.message);
    }
}

async function quickTest() {
    console.log('🚀 Quick API Test with Current Token');
    console.log('===================================\n');
    
    try {
        const content = await fs.readFile('./data/sync_state.json');
        const credentials = JSON.parse(content);
        const authClient = google.auth.fromJSON(credentials);
        const tokenInfo = await authClient.getAccessToken();
        
        await testAPICalls(authClient, tokenInfo.token, 'current token');
    } catch (error) {
        console.log('❌ Failed to test with current token:', error.message);
        console.log('Please run the main application first to authenticate.');
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--quick') || args.includes('-q')) {
        await quickTest();
    } else {
        console.log('This will test different OAuth scopes interactively.');
        console.log('Run with --quick or -q to just test current token.\n');
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const proceed = await new Promise(resolve => {
            rl.question('Proceed with full scope testing? (y/N): ', answer => {
                rl.close();
                resolve(answer.toLowerCase().startsWith('y'));
            });
        });

        if (proceed) {
            await testDifferentScopes();
        } else {
            await quickTest();
        }
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { testDifferentScopes, quickTest }; 