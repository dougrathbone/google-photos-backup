const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

// --- Configuration (Could be passed as args or read from env if needed) ---
// Assuming standard paths based on installation
const APP_NAME = 'google-photos-backup';
const DATA_DIR = `/var/lib/${APP_NAME}`;
const STATUS_FILENAME = 'status.json'; 
const SERVICE_NAME = `${APP_NAME}.service`;
const TIMER_NAME = `${APP_NAME}.timer`;
const statusFilePath = path.join(DATA_DIR, STATUS_FILENAME);

// --- Helper Functions ---

// Use standard ANSI escape codes for colors
function echoBlue(text) { console.log(`\x1b[34m${text}\x1b[0m`); }
function echoRed(text) { console.log(`\x1b[31m${text}\x1b[0m`); }
function echoYellow(text) { console.log(`\x1b[33m${text}\x1b[0m`); }

function executeCommand(command) {
    try {
        // Execute command synchronously, inherit stdio for direct output/errors if needed
        // Use a timeout to prevent hanging
        const output = execSync(command, { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }); 
        return { success: true, output: output.trim() };
    } catch (error) {
        // error.stderr might contain useful info from the command
        // error.stdout might also have partial output
        // error.status is the exit code
        return {
            success: false, 
            error: error.message, 
            stderr: error.stderr?.toString().trim(),
            stdout: error.stdout?.toString().trim(),
            status: error.status
        };
    }
}

function parseSystemctlOutput(output) {
    const statusInfo = { state: 'unknown', substate: 'unknown', loaded: 'unknown', nextRun: null };
    if (!output) return statusInfo;

    // Use \s* for whitespace flexibility
    const loadedMatch = output.match(/^\s*Loaded:\s*([^\(]+)/m);
    if (loadedMatch) statusInfo.loaded = loadedMatch[1].trim();

    // Match state and substate more carefully
    const activeMatch = output.match(/^\s*Active:\s*([^\s]+)\s+\(([^\)]+)\)/m);
    if (activeMatch) {
        statusInfo.state = activeMatch[1].trim();
        statusInfo.substate = activeMatch[2].trim();
    }
    
    // For timers, look for Trigger or Next elapse
    const triggerMatch = output.match(/^\s*Trigger:\s*(.*)$/m);
    if (triggerMatch) {
        statusInfo.nextRun = triggerMatch[1].trim();
    } else {
        const nextElapseMatch = output.match(/^\s*Next elapse:\s*(.*)$/m);
        if (nextElapseMatch) {
            statusInfo.nextRun = nextElapseMatch[1].trim();
        }
    }
    
    // Simplify state if it includes 'failed'
    if (statusInfo.state.includes('failed')) {
         statusInfo.state = 'failed';
    }

    return statusInfo;
}

function formatTimestamp(isoTimestamp) {
    if (!isoTimestamp || isoTimestamp === 'Never' || isoTimestamp === 'N/A') {
        return isoTimestamp;
    }
    try {
        const date = new Date(isoTimestamp);
        return date.toLocaleString(); // Uses system locale for formatting
    } catch (e) {
        return isoTimestamp; // Return original if parsing fails
    }
}

// --- Main Logic ---
async function displayStatus() {
    let statusData = null;
    let appStatusReadError = null;

    echoBlue("--- Google Photos Backup Status ---");

    // 1. Read Application Status File
    try {
        const content = await fs.readFile(statusFilePath, 'utf8');
        statusData = JSON.parse(content);
    } catch (error) {
        if (error.code === 'ENOENT') {
            appStatusReadError = `Status file not found: ${statusFilePath}`;
        } else {
            appStatusReadError = `Error reading status file ${statusFilePath}: ${error.message}`;
        }
        echoYellow(`    Warning: ${appStatusReadError}`);
    }

    // Display App Status
    const currentAppState = statusData?.status || (appStatusReadError ? 'Error' : 'Unknown');
    const lastSyncTime = formatTimestamp(statusData?.lastSyncTimestamp || 'Never');
    const lastFinishTime = formatTimestamp(statusData?.lastRunFinish || 'N/A');
    const lastOutcome = statusData?.lastRunOutcome || 'N/A';
    const lastDownloaded = statusData?.lastRunItemsDownloaded ?? 'N/A'; // Use nullish coalescing
    const lastError = statusData?.lastRunError || 'None';

    console.log(` Application State: ${currentAppState}`);
    console.log(` Last Sync Success: ${lastSyncTime}`);
    console.log(` Last Run Finished: ${lastFinishTime}`);
    console.log(` Last Run Outcome:  ${lastOutcome}`);
    console.log(` Last Run Stats:    Downloaded ${lastDownloaded} items.`);
    if (lastError && lastError !== 'None') {
        echoRed(`  Last Run Error:    ${lastError}`);
    }

    // 2. Get Systemd Service Status
    const serviceResult = executeCommand(`systemctl status ${SERVICE_NAME} --no-pager`);
    let serviceStatusText = 'Error checking status';
    if (serviceResult.success || serviceResult.status === 3) { // status 3 means inactive
        const parsed = parseSystemctlOutput(serviceResult.output);
        serviceStatusText = `${parsed.state} (${parsed.substate}) - Loaded: ${parsed.loaded}`;
    } else {
         serviceStatusText = `Error (${serviceResult.error || 'Unknown'})`;
         if(serviceResult.stderr) serviceStatusText += ` - ${serviceResult.stderr}`;
    }
    console.log(` Service State:     ${serviceStatusText}`);

    // 3. Get Systemd Timer Status
    // Check if timer unit exists before querying it
    const timerCheckResult = executeCommand(`systemctl list-unit-files ${TIMER_NAME}`);
    if (timerCheckResult.success && timerCheckResult.output.includes(TIMER_NAME)) {
        const timerResult = executeCommand(`systemctl status ${TIMER_NAME} --no-pager`);
        let timerStatusText = 'Error checking status';
        let nextRunText = 'N/A';
        if (timerResult.success || timerResult.status === 3) {
            const parsed = parseSystemctlOutput(timerResult.output);
            timerStatusText = `${parsed.state} (${parsed.substate})`;
            nextRunText = parsed.nextRun || 'Scheduled (pending)';
        } else {
             timerStatusText = `Error (${timerResult.error || 'Unknown'})`;
             if(timerResult.stderr) timerStatusText += ` - ${timerResult.stderr}`;
        }
         console.log(` Timer State:       ${timerStatusText}`);
         console.log(` Next Scheduled Run: ${nextRunText}`);
    } else {
        console.log(` Timer State:       N/A (Continuous Mode or Timer Not Installed)`);
    }
    
    echoBlue("-------------------------------------");
    // Note: Suggesting the wrapper command, not this script directly
    console.log(`(For detailed logs, run: ${APP_NAME} logs)`);
}

// Execute the function
displayStatus().catch(err => {
    echoRed("An unexpected error occurred during status display:");
    console.error(err);
    process.exitCode = 1; // Indicate failure
}); 