import * as fs from 'fs';
import * as path from 'path';

/**
 * Simple logger utility that wraps console methods
 * Avoids direct console usage which can interfere with MCP stdio
 *
 * Set DEBUG_LOG_FILE=true to enable file logging to debug.log in the project root
 * Or set DEBUG_LOG_FILE=/path/to/file.log to specify a custom log file
 */

// Check if file logging is enabled
// Use String() to ensure we're getting a string value even if it's a boolean or undefined
const DEBUG_LOG_FILE = String(process.env.DEBUG_LOG_FILE || '');
process.stderr.write(`[DEBUG] DEBUG_LOG_FILE environment variable: "${DEBUG_LOG_FILE}"\n`);

// Determine log file path
let logFilePath: string | null = null;

// Check if DEBUG_LOG_FILE is set to anything other than empty string
if (DEBUG_LOG_FILE && DEBUG_LOG_FILE !== 'false' && DEBUG_LOG_FILE !== 'undefined') {
  try {
    if (DEBUG_LOG_FILE === 'true') {
      // Use absolute path with current working directory
      const cwd = process.cwd();
      logFilePath = path.join(cwd, 'debug.log');
      process.stderr.write(`[DEBUG] Current working directory: ${cwd}\n`);
      process.stderr.write(`[DEBUG] Absolute log file path: ${logFilePath}\n`);
    } else {
      // Use specified path
      logFilePath = DEBUG_LOG_FILE;
    }

    // Test if we can write to the log file
    process.stderr.write(`[DEBUG] Testing if we can write to log file: ${logFilePath}\n`);
    try {
      // Check if the file exists
      const fileExists = fs.existsSync(logFilePath);
      process.stderr.write(`[DEBUG] Log file exists: ${fileExists}\n`);

      // Check if we have write permissions to the directory
      const logDir = path.dirname(logFilePath);
      try {
        fs.accessSync(logDir, fs.constants.W_OK);
        process.stderr.write(`[DEBUG] Have write permissions to log directory\n`);
      } catch (accessError) {
        process.stderr.write(`[ERROR] No write permissions to log directory: ${accessError}\n`);
      }

      // Try to write to the file
      const logMessage = `--- Log started at ${new Date().toISOString()} ---\n`;
      fs.appendFileSync(logFilePath, logMessage);
      process.stderr.write(`[INFO] Successfully wrote to log file: ${logFilePath}\n`);
    } catch (e) {
      process.stderr.write(`[WARN] Cannot write to log file: ${e}\n`);
      if (e instanceof Error) {
        process.stderr.write(`[WARN] Error stack: ${e.stack}\n`);
      }
      logFilePath = null;
    }
  } catch (e) {
    process.stderr.write(`[WARN] Error setting up file logging: ${e}\n`);
    logFilePath = null;
  }
}
/**
 * Helper function to write to log file
 */
const writeToLogFile = (content: string): void => {
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, content);
    } catch (e) {
      // Silently fail - we don't want to cause issues with the main process
    }
  }
};

export const logger = {
  info: (message: string, ...args: any[]) => {
    const logMessage = `[INFO] ${message}\n`;
    process.stderr.write(logMessage);

    // Write to log file if enabled
    if (logFilePath) {
      try {
        writeToLogFile(logMessage);
        if (args.length > 0) {
          writeToLogFile(`${JSON.stringify(args, null, 2)}\n`);
        }
      } catch (e) {
        // Silently fail
      }
    }
  },

  error: (message: string, error?: any) => {
    const logMessage = `[ERROR] ${message}\n`;
    process.stderr.write(logMessage);

    // Write to log file if enabled
    if (logFilePath) {
      try {
        writeToLogFile(logMessage);
        if (error) {
          const errorStr = error instanceof Error ? error.stack : JSON.stringify(error, null, 2);
          writeToLogFile(`${errorStr}\n`);
        }
      } catch (e) {
        // Silently fail
      }
    }
  },

  debug: (message: string, ...args: any[]) => {
    const logMessage = `[DEBUG] ${message}\n`;
    process.stderr.write(logMessage);

    // Write to log file if enabled
    if (logFilePath) {
      try {
        writeToLogFile(logMessage);
        if (args.length > 0) {
          writeToLogFile(`${JSON.stringify(args, null, 2)}\n`);
        }
      } catch (e) {
        // Silently fail
      }
    }
  },

  warn: (message: string, ...args: any[]) => {
    const logMessage = `[WARN] ${message}\n`;
    process.stderr.write(logMessage);

    // Write to log file if enabled
    if (logFilePath) {
      try {
        writeToLogFile(logMessage);
        if (args.length > 0) {
          writeToLogFile(`${JSON.stringify(args, null, 2)}\n`);
        }
      } catch (e) {
        // Silently fail
      }
    }
  },
};
