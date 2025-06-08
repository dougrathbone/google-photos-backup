/**
 * Centralized error handling module for consistent error management
 * across the Google Photos Backup application.
 */

/**
 * Error types for categorizing different kinds of errors
 */
const ErrorTypes = {
    CONFIGURATION: 'configuration',
    AUTHENTICATION: 'authentication',
    NETWORK: 'network',
    FILE_SYSTEM: 'file_system',
    API: 'api',
    LOCK: 'lock',
    UNKNOWN: 'unknown'
};

/**
 * Error severity levels
 */
const ErrorSeverity = {
    CRITICAL: 'critical',    // Application cannot continue
    ERROR: 'error',          // Operation failed but app can continue
    WARNING: 'warning',      // Potential issue but operation succeeded
    INFO: 'info'            // Informational message
};

/**
 * Standardized error class for the application
 */
class AppError extends Error {
    constructor(message, type = ErrorTypes.UNKNOWN, severity = ErrorSeverity.ERROR, originalError = null) {
        super(message);
        this.name = 'AppError';
        this.type = type;
        this.severity = severity;
        this.originalError = originalError;
        this.timestamp = new Date().toISOString();
        
        // Capture stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AppError);
        }
    }
}

/**
 * Centralized error handler class
 */
class ErrorHandler {
    constructor(logger, statusUpdater) {
        this.logger = logger;
        this.statusUpdater = statusUpdater;
    }

    /**
     * Handles errors with consistent logging and status updates
     * @param {Error|AppError} error - The error to handle
     * @param {string} context - Context where the error occurred
     * @param {boolean} shouldExit - Whether the application should exit after handling
     * @returns {boolean} Whether the error was handled successfully
     */
    async handleError(error, context = 'Unknown', shouldExit = false) {
        const isAppError = error instanceof AppError;
        const errorType = isAppError ? error.type : ErrorTypes.UNKNOWN;
        const severity = isAppError ? error.severity : ErrorSeverity.ERROR;
        
        const errorInfo = {
            message: error.message,
            type: errorType,
            severity: severity,
            context: context,
            timestamp: new Date().toISOString(),
            stack: error.stack
        };

        // Log based on severity
        switch (severity) {
            case ErrorSeverity.CRITICAL:
                this.logger.error(`CRITICAL ERROR in ${context}: ${error.message}`, errorInfo);
                break;
            case ErrorSeverity.ERROR:
                this.logger.error(`ERROR in ${context}: ${error.message}`, errorInfo);
                break;
            case ErrorSeverity.WARNING:
                this.logger.warn(`WARNING in ${context}: ${error.message}`, errorInfo);
                break;
            case ErrorSeverity.INFO:
                this.logger.info(`INFO in ${context}: ${error.message}`, errorInfo);
                break;
        }

        // Update status if statusUpdater is available
        if (this.statusUpdater && severity !== ErrorSeverity.INFO) {
            try {
                await this.statusUpdater.updateStatus({
                    status: severity === ErrorSeverity.CRITICAL ? 'failed' : 'error',
                    lastRunError: error.message,
                    lastRunFinish: new Date().toISOString()
                }, this.logger);
            } catch (statusError) {
                this.logger.error('Failed to update status after error:', statusError);
            }
        }

        // Exit if requested and severity is critical
        if (shouldExit && severity === ErrorSeverity.CRITICAL) {
            this.logger.error('Application exiting due to critical error');
            process.exit(1);
        }

        return true;
    }

    /**
     * Creates a standardized error for configuration issues
     * @param {string} message - Error message
     * @param {Error} originalError - Original error if any
     * @returns {AppError}
     */
    createConfigurationError(message, originalError = null) {
        return new AppError(message, ErrorTypes.CONFIGURATION, ErrorSeverity.CRITICAL, originalError);
    }

    /**
     * Creates a standardized error for authentication issues
     * @param {string} message - Error message
     * @param {Error} originalError - Original error if any
     * @returns {AppError}
     */
    createAuthenticationError(message, originalError = null) {
        return new AppError(message, ErrorTypes.AUTHENTICATION, ErrorSeverity.CRITICAL, originalError);
    }

    /**
     * Creates a standardized error for network issues
     * @param {string} message - Error message
     * @param {Error} originalError - Original error if any
     * @returns {AppError}
     */
    createNetworkError(message, originalError = null) {
        return new AppError(message, ErrorTypes.NETWORK, ErrorSeverity.ERROR, originalError);
    }

    /**
     * Creates a standardized error for file system issues
     * @param {string} message - Error message
     * @param {Error} originalError - Original error if any
     * @returns {AppError}
     */
    createFileSystemError(message, originalError = null) {
        return new AppError(message, ErrorTypes.FILE_SYSTEM, ErrorSeverity.ERROR, originalError);
    }

    /**
     * Creates a standardized error for API issues
     * @param {string} message - Error message
     * @param {Error} originalError - Original error if any
     * @returns {AppError}
     */
    createApiError(message, originalError = null) {
        return new AppError(message, ErrorTypes.API, ErrorSeverity.ERROR, originalError);
    }

    /**
     * Creates a standardized error for lock issues
     * @param {string} message - Error message
     * @param {Error} originalError - Original error if any
     * @returns {AppError}
     */
    createLockError(message, originalError = null) {
        return new AppError(message, ErrorTypes.LOCK, ErrorSeverity.WARNING, originalError);
    }

    /**
     * Wraps a function to handle errors consistently
     * @param {Function} fn - Function to wrap
     * @param {string} context - Context for error handling
     * @returns {Function} Wrapped function
     */
    wrapFunction(fn, context) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                await this.handleError(error, context);
                throw error; // Re-throw to maintain original behavior
            }
        };
    }
}

module.exports = {
    ErrorHandler,
    AppError,
    ErrorTypes,
    ErrorSeverity
}; 