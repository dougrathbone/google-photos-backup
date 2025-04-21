#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;
const ps = require('ps-node'); // To check if PID is running

// Assume config and status files are in the standard location relative to the script
// This makes it runnable directly without complex config loading just for status
const CONFIG_DIR = path.resolve(__dirname, '../.config/google-photos-backup'); // Adjust if needed
const DATA_DIR = path.resolve(__dirname, '../.local/share/google-photos-backup/data'); // Adjust if needed
// --- OR --- load config first to get paths? More robust but adds overhead.
// Let's try loading config first for robustness.

const configPath = path.resolve(__dirname, '../config.json'); // Assumes script run from project root for dev
// In installed location, this won't work directly. Installer needs to place this script?
// Or status script needs to find config in standard user location.
// Let's assume status script is run from INSTALLED location for now.

const APP_NAME = "google-photos-backup";
const DEFAULT_CONFIG_DIR = path.join(process.env.HOME, '.config', APP_NAME);
const DEFAULT_DATA_DIR = path.join(process.env.HOME, '.local', 'share', APP_NAME, 'data');
const installedConfigPath = path.join(DEFAULT_CONFIG_DIR, 'config.json');
const statusFilePath = path.join(DEFAULT_DATA_DIR, 'sync_status.json');

// Helper to check if a PID is running
function isPidRunning(pid) {
    return new Promise((resolve) => {
        if (!pid) return resolve(false);
        ps.lookup({ pid: pid }, (err, resultList) => {
            if (err) {
                console.error(`Error checking PID ${pid}:`, err);
                resolve(false); // Assume not running on error
            } else {
                resolve(resultList.length > 0);
            }
        });
    });
}

// Helper to format time difference
function formatDuration(ms) {
    if (ms < 0) ms = -ms;
    const time = {
        d: Math.floor(ms / 86400000),
        h: Math.floor(ms / 3600000) % 24,
        m: Math.floor(ms / 60000) % 60,
        s: Math.floor(ms / 1000) % 60,
    };
    return Object.entries(time)
        .filter(val => val[1] !== 0)
        .map(([key, val]) => `${val}${key}`)
        .join(' ');
}

async function showStatus() {
    console.log('--- Google Photos Backup Status ---');
    let statusData;
    try {
        const statusFileContent = await fs.readFile(statusFilePath, 'utf8');
        statusData = JSON.parse(statusFileContent);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log(`Status file not found at ${statusFilePath}.`);
            console.log('Possible reasons:');
            console.log(' - Application not installed correctly.');
            console.log(' - Application has never been run successfully.');
        } else {
            console.error(`Error reading or parsing status file ${statusFilePath}:`, err.message);
        }
        return;
    }

    console.log(`Status File: ${statusFilePath}`);
    console.log(`Last Known State: ${statusData.status}`);
    
    const pid = statusData.pid;
    let actuallyRunning = false;
    if (pid && statusData.status?.startsWith('running')) {
        actuallyRunning = await isPidRunning(pid);
        if (!actuallyRunning) {
             console.log(` -> Process ID ${pid} from status file is NOT currently running (stale status?).`);
             console.log(`    Current Status: idle (inferred)`);
        } else {
             console.log(` -> Process ID ${pid} IS currently running.`);
             console.log(`    Current Status: ${statusData.status}`);
        }
    } else {
         console.log(`    Current Status: ${statusData.status}`);
    }
    
    if (actuallyRunning) {
        const startTime = new Date(statusData.currentRunStartTimeISO);
        const uptimeMs = Date.now() - startTime.getTime();
        console.log(`    Sync Started: ${startTime.toLocaleString()} (${formatDuration(uptimeMs)} ago)`);
        console.log(`    Items Processed (This Run): ${statusData.currentRunItemsDownloaded} / ${statusData.currentRunTotalItems || '?'}`);
        if (statusData.currentRunTotalItems > 0 && statusData.currentRunItemsDownloaded > 0) {
             const percentage = ((statusData.currentRunItemsDownloaded / statusData.currentRunTotalItems) * 100).toFixed(1);
             console.log(`    Progress (This Run): ${percentage}%`);
        } else {
             console.log(`    Progress (This Run): 0%`);
        }
        // ETA calculation is complex and omitted for now
    }

    console.log(`Last Sync Ended: ${statusData.lastSyncTimestamp ? new Date(statusData.lastSyncTimestamp).toLocaleString() : 'Never'}`);
    console.log(`Last Run Summary: ${statusData.lastRunSummary || 'N/A'}`);
    console.log('-----------------------------------');
}

showStatus().catch(err => {
    console.error("Error getting status:", err);
}); 