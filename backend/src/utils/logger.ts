// src/utils/logger.ts

/**
 * Simple logging utility with different log levels
 * In production, you can extend this to write to files or cloud logging services
 */

const LOG_LEVELS = {
  ERROR: "ERROR",
  WARN: "WARN",
  INFO: "INFO",
  DEBUG: "DEBUG",
} as const;

type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS];
type LogContext = Record<string, unknown>;
type ErrorWithCode = Error & { code?: unknown };

// ANSI color codes for terminal output
const COLORS = {
  BLUE: "\x1b[34m",
  RESET: "\x1b[0m",
};

const isLogLevel = (level: string | undefined): level is LogLevel =>
  Object.values(LOG_LEVELS).includes(level as LogLevel);

class Logger {
  private level: LogLevel;

  constructor() {
    this.level = isLogLevel(process.env.LOG_LEVEL)
      ? process.env.LOG_LEVEL
      : LOG_LEVELS.INFO;
  }

  /**
   * Format log message with timestamp and context
   */
  private _format(level: LogLevel, message: string, context: LogContext = {}) {
    const timestamp = new Date().toISOString();
    const contextStr =
      Object.keys(context).length > 0 ? JSON.stringify(context, null, 2) : "";

    return `${COLORS.BLUE}[${timestamp}] [${level}] ${message} ${contextStr}${COLORS.RESET}`;
  }

  /**
   * Log error messages
   */
  error(message: string, error: unknown = null, context: LogContext = {}) {
    let errorInfo: LogContext | null = null;

    if (error instanceof Error) {
      // Called correctly: logger.error(msg, new Error(...))
      const errorWithCode = error as ErrorWithCode;
      errorInfo = {
        message: error.message,
        stack: error.stack,
        code: errorWithCode.code,
      };
    } else if (error !== null && typeof error === "object") {
      // Called with plain context object: logger.error(msg, { error: ..., ... })
      // Treat it as extra context and extract error details if present
      const errorContext = error as LogContext;
      context = { ...errorContext, ...context };
      const errVal = errorContext.error;
      if (errVal) {
        errorInfo =
          typeof errVal === "string" ? { message: errVal } : (errVal as LogContext);
      }
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
  warn(message: string, context: LogContext = {}) {
    if (this._shouldLog(LOG_LEVELS.WARN)) {
      console.warn(this._format(LOG_LEVELS.WARN, message, context));
    }
  }

  /**
   * Log info messages
   */
  info(message: string, context: LogContext = {}) {
    if (this._shouldLog(LOG_LEVELS.INFO)) {
      console.log(this._format(LOG_LEVELS.INFO, message, context));
    }
  }

  /**
   * Log debug messages
   */
  debug(message: string, context: LogContext = {}) {
    if (this._shouldLog(LOG_LEVELS.DEBUG)) {
      console.log(this._format(LOG_LEVELS.DEBUG, message, context));
    }
  }

  /**
   * Determine if log should be written based on current level
   */
  private _shouldLog(level: LogLevel) {
    const levels: LogLevel[] = [
      LOG_LEVELS.ERROR,
      LOG_LEVELS.WARN,
      LOG_LEVELS.INFO,
      LOG_LEVELS.DEBUG,
    ];
    const currentLevelIndex = levels.indexOf(this.level);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  /**
   * Log the start of a data sync operation
   */
  syncStart(source: string, context: LogContext = {}) {
    this.info(`Starting sync for ${source}`, {
      source,
      operation: "sync_start",
      ...context,
    });
  }

  /**
   * Log successful sync completion
   */
  syncComplete(source: string, stats: LogContext = {}) {
    this.info(`Sync completed for ${source}`, {
      source,
      operation: "sync_complete",
      ...stats,
    });
  }

  /**
   * Log sync failure
   */
  syncFailed(source: string, error: unknown, context: LogContext = {}) {
    this.error(`Sync failed for ${source}`, error, {
      source,
      operation: "sync_failed",
      ...context,
    });
  }
}

// Export singleton instance
export const logger = new Logger();
