const path = require('path');

// Mock external dependencies
const mockReadFile = jest.fn();
const mockExecSync = jest.fn();

jest.mock('fs', () => ({
    promises: {
        readFile: mockReadFile,
    }
}));
jest.mock('child_process', () => ({
    execSync: mockExecSync,
}));

const fs = require('fs').promises;
const { execSync } = require('child_process');

// --- Test Setup ---

// Store original console.log/error etc.
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn; // If statusDisplay uses it

// Helper function to capture console output
async function captureConsoleOutput(asyncFunc) {
    const output = { log: [], error: [], warn: [] };
    console.log = (...args) => { 
        // Remove ANSI escape codes for testing
        const cleanText = args.join(' ').replace(/\x1b\[[0-9;]*m/g, '');
        output.log.push(cleanText); 
    };
    console.error = (...args) => { 
        const cleanText = args.join(' ').replace(/\x1b\[[0-9;]*m/g, '');
        output.error.push(cleanText); 
    };
    
    try {
        await asyncFunc();
    } finally {
        // Restore original console functions
        console.log = originalLog;
        console.error = originalError;
    }
    return output;
}

describe('Status Display Script', () => {
    let statusDisplayScript;

    const APP_NAME = 'google-photos-backup';
    const DATA_DIR = `/var/lib/${APP_NAME}`;
    const STATUS_FILENAME = 'status.json'; 
    const SERVICE_NAME = `${APP_NAME}.service`;
    const TIMER_NAME = `${APP_NAME}.timer`;
    const statusFilePath = path.join(DATA_DIR, STATUS_FILENAME);

    beforeEach(() => {
        jest.resetModules(); // Reset modules to isolate tests
        jest.clearAllMocks(); // Clear mock calls
        
        // Clear the module cache for statusDisplay to ensure fresh execution
        delete require.cache[require.resolve('../src/statusDisplay')];
        
        // Mock successful file read and command execution by default
        mockReadFile.mockResolvedValue(JSON.stringify({
            status: 'idle',
            lastSyncTimestamp: '2024-01-01T10:00:00Z',
            lastRunOutcome: 'success',
            lastRunItemsDownloaded: 55,
            lastRunFinish: '2024-01-01T10:05:00Z'
        }));
        
        // Mock systemctl outputs
        mockExecSync.mockImplementation((command) => {
            if (command.includes(`status ${SERVICE_NAME}`)) {
                return `  Loaded: loaded (/etc/systemd/system/google-photos-backup.service; enabled; vendor preset: enabled)
  Active: inactive (dead) since Mon 2024-01-01 10:05:00 UTC; 1 day 2h ago
 Main PID: 12345 (code=exited, status=0/SUCCESS)`;
            } else if (command.includes(`list-unit-files ${TIMER_NAME}`)) {
                return `${TIMER_NAME} enabled`; // Simulate timer exists
            } else if (command.includes(`status ${TIMER_NAME}`)) {
                return `  Loaded: loaded (/etc/systemd/system/google-photos-backup.timer; enabled; vendor preset: enabled)
  Active: active (waiting) since Mon 2024-01-01 10:05:00 UTC; 1 day 2h ago
 Trigger: Tue 2024-01-02 11:00:00 UTC; 1h 15min left`;
            }
            return ''; // Return empty string instead of throwing for unhandled commands
        });
        
        // Require the script under test *after* mocks are set up
        // Note: Requiring runs the script because it calls displayStatus() at the end
        // We capture output instead of testing the displayStatus function directly
        // statusDisplayScript = require('../src/statusDisplay');
    });

    afterAll(() => {
         // Restore original console potentially modified by capture helper
         console.log = originalLog;
         console.error = originalError;
    });

    test('should display status correctly with successful last sync', async () => {
        // Set up mocks before requiring the module
        mockReadFile.mockResolvedValue(JSON.stringify({
            status: 'idle',
            lastSyncTimestamp: '2024-01-01T10:00:00Z',
            lastRunOutcome: 'success',
            lastRunItemsDownloaded: 55,
            lastRunFinish: '2024-01-01T10:05:00Z'
        }));
        
        // Run the script and capture output
        const output = await captureConsoleOutput(async () => {
            require('../src/statusDisplay');
            // Give the async displayStatus function time to complete
            await new Promise(resolve => setTimeout(resolve, 100));
        });
        
        // Check captured output
        expect(output.log.join('\n')).toContain('Application State: idle');
        expect(output.log.join('\n')).toMatch(/Last Sync Success: .*2024/); // Check timestamp formatted
        expect(output.log.join('\n')).toMatch(/Last Run Finished: .*2024/); 
        expect(output.log.join('\n')).toContain('Last Run Outcome:  success');
        expect(output.log.join('\n')).toContain('Last Run Stats:    Downloaded 55 items.');
        expect(output.log.join('\n')).not.toContain('Last Run Error');
        expect(output.log.join('\n')).toContain('Service State:     inactive (dead) - Loaded: loaded');
        expect(output.log.join('\n')).toContain('Timer State:       active (waiting)');
        expect(output.log.join('\n')).toMatch(/Next Scheduled Run: .*Tue 2024-01-02 11:00:00 UTC/);
        expect(output.error).toEqual([]); // No errors expected
    });

    test('should display status correctly with failed last sync', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify({
            status: 'failed',
            lastSyncTimestamp: '2024-01-01T10:00:00Z',
            lastRunOutcome: 'failure',
            lastRunItemsDownloaded: 10,
            lastRunError: 'API rate limit exceeded',
            lastRunFinish: '2024-01-02T11:15:00Z'
        }));
        mockExecSync.mockImplementation((command) => {
            if (command.includes(`status ${SERVICE_NAME}`)) {
                return `  Loaded: loaded (/etc/systemd/system/google-photos-backup.service; enabled; vendor preset: enabled)
  Active: failed (Result: exit-code) since Tue 2024-01-02 11:15:00 UTC; 1h ago
 Main PID: 98765 (code=exited, status=1/FAILURE)`;
            } else if (command.includes(`list-unit-files ${TIMER_NAME}`)) {
                 return `${TIMER_NAME} enabled`;
            } else if (command.includes(`status ${TIMER_NAME}`)) {
                return `  Loaded: loaded (/etc/systemd/system/google-photos-backup.timer; enabled; vendor preset: enabled)
  Active: inactive (dead)`; 
            }
            return '';
        });

        const output = await captureConsoleOutput(async () => {
            require('../src/statusDisplay');
            // Give the async displayStatus function time to complete
            await new Promise(resolve => setTimeout(resolve, 100));
        });

        expect(output.log.join('\n')).toContain('Application State: failed');
        expect(output.log.join('\n')).toMatch(/Last Sync Success: .*2024/); 
        expect(output.log.join('\n')).toMatch(/Last Run Finished: .*2024/);
        expect(output.log.join('\n')).toContain('Last Run Outcome:  failure');
        expect(output.log.join('\n')).toContain('Last Run Stats:    Downloaded 10 items.');
        expect(output.log.join('\n')).toContain('Last Run Error:    API rate limit exceeded');
        expect(output.log.join('\n')).toContain('Service State:     failed (Result: exit-code) - Loaded: loaded');
        expect(output.log.join('\n')).toContain('Timer State:       inactive (dead)');
        expect(output.log.join('\n')).toContain('Next Scheduled Run: Scheduled (pending)');
        expect(output.error).toEqual([]);
    });

    test('should display status correctly when status file is missing', async () => {
        const error = new Error('ENOENT');
        error.code = 'ENOENT';
        mockReadFile.mockRejectedValue(error);
        // Assume systemd commands still work
        mockExecSync.mockImplementation((command) => {
            if (command.includes(`status ${SERVICE_NAME}`)) return `Active: active (running) ...`;
            if (command.includes(`list-unit-files ${TIMER_NAME}`)) return ''; // Timer not found
            if (command.includes(`status ${TIMER_NAME}`)) return ''; 
            return '';
        });
        
        const output = await captureConsoleOutput(async () => {
            require('../src/statusDisplay');
            // Give the async displayStatus function time to complete
            await new Promise(resolve => setTimeout(resolve, 100));
        });
        
        expect(output.log.join('\n')).toContain('Application State: Error');
        expect(output.log.join('\n')).toContain('Last Sync Success: Never');
        expect(output.log.join('\n')).toContain('Warning: Status file not found');
        expect(output.log.join('\n')).toContain('Service State:     active (running) - Loaded: unknown');
        expect(output.log.join('\n')).toContain('Timer State:       N/A (Continuous Mode or Timer Not Installed)');
        expect(output.error).toEqual([]);
    });
    
     test('should display error when systemctl command fails', async () => {
        const cmdError = new Error('Command failed');
        mockExecSync.mockImplementation((command) => {
            if (command.includes('systemctl')) throw cmdError;
            return '';
        });

        const output = await captureConsoleOutput(async () => {
            require('../src/statusDisplay');
            // Give the async displayStatus function time to complete
            await new Promise(resolve => setTimeout(resolve, 100));
        });
        
        expect(output.log.join('\n')).toContain('Service State:     Error (Command failed)');
        // Timer check will also fail
        expect(output.log.join('\n')).toContain('Timer State:       N/A (Continuous Mode or Timer Not Installed)');
        expect(output.error).toEqual([]); // Errors handled internally by script
    });
}); 