// src/utils/logger.js

/**
 * Simple logging utility with different log levels
 * In production, you can extend this to write to files or cloud logging services
 */

const LOG_LEVELS = {
  ERROR: "ERROR",
  WARN: "WARN",
  INFO: "INFO",
  DEBUG: "DEBUG",
};

// ANSI color codes for terminal output
const COLORS = {
  BLUE: "\x1b[34m",
  RESET: "\x1b[0m",
};

class Logger {
  constructor() {
    this.level = process.env.LOG_LEVEL || "INFO";
  }

  /**
   * Format log message with timestamp and context
   */
  _format(level, message, context = {}) {
    const timestamp = new Date().toISOString();
    const contextStr =
      Object.keys(context).length > 0 ? JSON.stringify(context, null, 2) : "";

    return `${COLORS.BLUE}[${timestamp}] [${level}] ${message} ${contextStr}${COLORS.RESET}`;
  }

  /**
   * Log error messages
   */
  error(message, error = null, context = {}) {
    let errorInfo = null;

    if (error instanceof Error) {
      // Called correctly: logger.error(msg, new Error(...))
      errorInfo = {
        message: error.message,
        stack: error.stack,
        code: error.code,
      };
    } else if (error !== null && typeof error === "object") {
      // Called with plain context object: logger.error(msg, { error: ..., ... })
      // Treat it as extra context and extract error details if present
      context = { ...error, ...context };
      const errVal = error.error;
      if (errVal) {
        errorInfo = typeof errVal === "string" ? { message: errVal } : errVal;
      }
      error = null;
    }

    const logMessage = this._format(LOG_LEVELS.ERROR, message, {
      ...context,
      ...(errorInfo ? { error: errorInfo } : {}),
    });
    console.error(logMessage);
  }

  /**
   * Log warning messages
   */
  warn(message, context = {}) {
    if (this._shouldLog(LOG_LEVELS.WARN)) {
      console.warn(this._format(LOG_LEVELS.WARN, message, context));
    }
  }

  /**
   * Log info messages
   */
  info(message, context = {}) {
    if (this._shouldLog(LOG_LEVELS.INFO)) {
      console.log(this._format(LOG_LEVELS.INFO, message, context));
    }
  }

  /**
   * Log debug messages
   */
  debug(message, context = {}) {
    if (this._shouldLog(LOG_LEVELS.DEBUG)) {
      console.log(this._format(LOG_LEVELS.DEBUG, message, context));
    }
  }

  /**
   * Determine if log should be written based on current level
   */
  _shouldLog(level) {
    const levels = ["ERROR", "WARN", "INFO", "DEBUG"];
    const currentLevelIndex = levels.indexOf(this.level);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  /**
   * Log the start of a data sync operation
   */
  syncStart(source, context = {}) {
    this.info(`Starting sync for ${source}`, {
      source,
      operation: "sync_start",
      ...context,
    });
  }

  /**
   * Log successful sync completion
   */
  syncComplete(source, stats = {}) {
    this.info(`Sync completed for ${source}`, {
      source,
      operation: "sync_complete",
      ...stats,
    });
  }

  /**
   * Log sync failure
   */
  syncFailed(source, error, context = {}) {
    this.error(`Sync failed for ${source}`, error, {
      source,
      operation: "sync_failed",
      ...context,
    });
  }
}

// Export singleton instance
export const logger = new Logger();
