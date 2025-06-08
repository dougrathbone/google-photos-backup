#!/usr/bin/env node

/**
 * Google Photos API Diagnostic Test
 * Tests various API endpoints and scopes to understand the restriction scope
 */

const fs = require('fs').promises;
const { google } = require('googleapis');
const Photos = require('googlephotos');

async function loadCredentials() {
    try {
        const content = await fs.readFile('./data/sync_state.json');
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (error) {
        console.error('Failed to load credentials:', error.message);
        console.log('Please run the main application first to authenticate.');
        process.exit(1);
    }
}

async function testGoogleAPIs() {
    console.log('🔍 Google Photos API Diagnostic Test');
    console.log('=====================================\n');
    
    const authClient = await loadCredentials();
    let accessToken;
    
    try {
        const tokenInfo = await authClient.getAccessToken();
        accessToken = tokenInfo.token;
        console.log('✅ Access token acquired successfully');
        console.log(`Token (first 20 chars): ${accessToken.substring(0, 20)}...`);
    } catch (error) {
        console.error('❌ Failed to get access token:', error.message);
        return;
    }

    console.log('\n--- Testing googleapis library ---');
    
    // Test 1: googleapis library approach
    try {
        const photos = google.photoslibrary({ version: 'v1', auth: authClient });
        console.log('🧪 Testing mediaItems.list via googleapis...');
        
        const response = await photos.mediaItems.list({ pageSize: 1 });
        console.log('✅ googleapis mediaItems.list succeeded');
        console.log(`   Found ${response.data.mediaItems?.length || 0} items`);
    } catch (error) {
        console.log('❌ googleapis mediaItems.list failed:', error.message);
        if (error.response?.data) {
            console.log('   Error details:', JSON.stringify(error.response.data, null, 2));
        }
    }

    // Test 2: albums via googleapis
    try {
        const photos = google.photoslibrary({ version: 'v1', auth: authClient });
        console.log('🧪 Testing albums.list via googleapis...');
        
        const response = await photos.albums.list({ pageSize: 1 });
        console.log('✅ googleapis albums.list succeeded');
        console.log(`   Found ${response.data.albums?.length || 0} albums`);
    } catch (error) {
        console.log('❌ googleapis albums.list failed:', error.message);
        if (error.response?.data) {
            console.log('   Error details:', JSON.stringify(error.response.data, null, 2));
        }
    }

    console.log('\n--- Testing googlephotos library ---');
    
    // Test 3: googlephotos library (what the app currently uses)
    try {
        const photos = new Photos(accessToken);
        console.log('🧪 Testing mediaItems.list via googlephotos...');
        
        const response = await photos.mediaItems.list(1);
        console.log('✅ googlephotos mediaItems.list succeeded');
        console.log(`   Found ${response.mediaItems?.length || 0} items`);
    } catch (error) {
        console.log('❌ googlephotos mediaItems.list failed:', error.message);
        if (error.response?.data) {
            console.log('   Error details:', JSON.stringify(error.response.data, null, 2));
        }
    }

    // Test 4: albums via googlephotos
    try {
        const photos = new Photos(accessToken);
        console.log('🧪 Testing albums.list via googlephotos...');
        
        const response = await photos.albums.list(1);
        console.log('✅ googlephotos albums.list succeeded');
        console.log(`   Found ${response.albums?.length || 0} albums`);
    } catch (error) {
        console.log('❌ googlephotos albums.list failed:', error.message);
        if (error.response?.data) {
            console.log('   Error details:', JSON.stringify(error.response.data, null, 2));
        }
    }

    console.log('\n--- API Scope Analysis ---');
    console.log('Current scopes requested: photoslibrary.readonly');
    console.log('Recommendation: The Forbidden errors suggest Google has restricted');
    console.log('access to existing photos via third-party apps as per the 2025 policy changes.');
    console.log('\nPossible solutions:');
    console.log('1. Request broader scopes (may not help due to policy)');
    console.log('2. Use Google Takeout for bulk export');
    console.log('3. Only sync new photos uploaded after app creation');
    console.log('4. Apply for Google verification if building a business app');
}

if (require.main === module) {
    testGoogleAPIs().catch(console.error);
}

module.exports = { testGoogleAPIs }; 