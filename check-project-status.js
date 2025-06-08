#!/usr/bin/env node

/**
 * Google Cloud Project Status Checker
 * Checks if the Google Photos Library API is properly enabled and configured
 */

const fs = require('fs').promises;
const { google } = require('googleapis');

async function checkProjectStatus() {
    console.log('🔍 Google Cloud Project Status Check');
    console.log('====================================\n');
    
    try {
        // Load credentials to get project info
        const content = await fs.readFile('./client_credentials.json');
        const credentials = JSON.parse(content);
        const projectId = credentials.installed.project_id;
        
        console.log(`📋 Project ID: ${projectId}`);
        console.log(`🔑 Client ID: ${credentials.installed.client_id}`);
        
        // Load auth token
        const tokenContent = await fs.readFile('./data/sync_state.json');
        const tokenCredentials = JSON.parse(tokenContent);
        const authClient = google.auth.fromJSON(tokenCredentials);
        
        console.log('\n📊 Checking API services...');
        
        // Try to check if Photos API is enabled using Service Usage API
        const serviceUsage = google.serviceusage({ version: 'v1', auth: authClient });
        
        try {
            const response = await serviceUsage.services.list({
                parent: `projects/${projectId}`,
                filter: 'state:ENABLED',
                pageSize: 200
            });
            
            const enabledServices = response.data.services || [];
            const photosLibraryService = enabledServices.find(service => 
                service.name.includes('photoslibrary.googleapis.com')
            );
            
            if (photosLibraryService) {
                console.log('✅ Google Photos Library API is enabled');
                console.log(`   Service: ${photosLibraryService.name}`);
                console.log(`   State: ${photosLibraryService.state}`);
            } else {
                console.log('❌ Google Photos Library API is NOT enabled');
                console.log('   You need to enable it in Google Cloud Console');
            }
            
            console.log(`\n📋 Total enabled APIs: ${enabledServices.length}`);
            console.log('Relevant APIs found:');
            enabledServices
                .filter(s => s.name.includes('photos') || s.name.includes('oauth') || s.name.includes('auth'))
                .forEach(service => {
                    console.log(`   - ${service.name} (${service.state})`);
                });
                
        } catch (serviceError) {
            console.log('⚠️  Could not check service status (might need additional permissions)');
            console.log(`   Error: ${serviceError.message}`);
        }
        
        console.log('\n🌐 Manual Check Instructions:');
        console.log('1. Go to https://console.cloud.google.com/');
        console.log(`2. Select project: ${projectId}`);
        console.log('3. Navigate to APIs & Services > Enabled APIs');
        console.log('4. Look for "Photos Library API"');
        console.log('5. If not found, go to Library and enable it');
        
        console.log('\n🔍 OAuth App Configuration:');
        console.log('1. Go to APIs & Services > Credentials');
        console.log('2. Check OAuth consent screen configuration');
        console.log('3. Verify app is not in "Testing" mode if you want external users');
        console.log('4. Check if app needs verification for sensitive scopes');
        
        // Test a simple API call to see what happens
        console.log('\n🧪 Testing basic Google API access...');
        try {
            const oauth2 = google.oauth2({ version: 'v2', auth: authClient });
            const userInfo = await oauth2.userinfo.get();
            console.log('✅ Basic Google API access works');
            console.log(`   User: ${userInfo.data.email}`);
        } catch (basicError) {
            console.log('❌ Basic Google API access failed:', basicError.message);
        }
        
    } catch (error) {
        console.log('❌ Error checking project status:', error.message);
    }
}

if (require.main === module) {
    checkProjectStatus().catch(console.error);
}

module.exports = { checkProjectStatus }; 