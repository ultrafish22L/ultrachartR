/**
 * Centralized logging service for UltraChart.
 *
 * Levels (decreasing importance):
 *   0 = ERROR   — fatal / unrecoverable issues
 *   1 = WARN    — unexpected but recoverable
 *   2 = INFO    — high-level operational messages
 *   3 = DEBUG   — developer-oriented detail
 *   4 = DEBUG_VERBOSE — very noisy / per-frame detail
 *
 * Usage:
 *   import { log } from '../services/Logger';
 *   log.info('MyTag', 'Something happened', optionalData);
 *
 * Runtime control (also accessible from browser console via window.ucLog):
 *   log.level = LogLevel.DEBUG;       // show DEBUG and above
 *   log.saveToFile = true;            // start accumulating entries for file export
 *   log.downloadLog();                // download accumulated log as .txt
 *   log.clear();                      // discard accumulated entries
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  DEBUG_VERBOSE = 4,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.DEBUG_VERBOSE]: 'VERBOSE',
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  levelName: string;
  tag: string;
  message: string;
}

class Logger {
  private _level: LogLevel = LogLevel.DEBUG;
  private _saveToFile = false;
  private _entries: LogEntry[] = [];
  private _maxEntries = 10_000;

  // ── Public config ────────────────────────────────────────────────

  /** Current filter level. Messages with level > this are suppressed. */
  get level(): LogLevel { return this._level; }
  set level(l: LogLevel) { this._level = l; }

  /** When true, log entries are accumulated in memory for later export. */
  get saveToFile(): boolean { return this._saveToFile; }
  set saveToFile(v: boolean) { this._saveToFile = v; }

  /** Number of stored entries (only when saveToFile is true). */
  get entryCount(): number { return this._entries.length; }

  // ── Logging methods ──────────────────────────────────────────────

  /** Level 0 — fatal / unrecoverable issues */
  error(tag: string, message: string, ...data: any[]): void {
    this._log(LogLevel.ERROR, tag, message, data);
  }

  /** Level 1 — unexpected but recoverable */
  warn(tag: string, message: string, ...data: any[]): void {
    this._log(LogLevel.WARN, tag, message, data);
  }

  /** Level 2 — high-level operational messages */
  info(tag: string, message: string, ...data: any[]): void {
    this._log(LogLevel.INFO, tag, message, data);
  }

  /** Level 3 — developer-oriented detail */
  debug(tag: string, message: string, ...data: any[]): void {
    this._log(LogLevel.DEBUG, tag, message, data);
  }

  /** Level 4 — very noisy / per-frame detail */
  debugVerbose(tag: string, message: string, ...data: any[]): void {
    this._log(LogLevel.DEBUG_VERBOSE, tag, message, data);
  }

  // ── File export ──────────────────────────────────────────────────

  /** Get all stored log entries as formatted text */
  getLogText(): string {
    return this._entries
      .map((e) => `${e.timestamp} [${e.levelName}][${e.tag}] ${e.message}`)
      .join('\n');
  }

  /** Download stored log entries as a text file */
  downloadLog(filename = 'ultrachart.log'): void {
    const text = this.getLogText();
    if (!text) {
      console.warn('[Logger] No log entries to download. Set log.saveToFile = true first.');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    // Defer cleanup to ensure the download starts before URL is revoked
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /** Clear stored entries */
  clear(): void {
    this._entries = [];
  }

  // ── Internal ─────────────────────────────────────────────────────

  private _log(level: LogLevel, tag: string, message: string, data: any[]): void {
    if (level > this._level) return;

    const now = new Date();
    const timestamp = now.toISOString();
    const levelName = LEVEL_NAMES[level];

    // Console output
    const prefix = `[${levelName}][${tag}]`;
    const consoleFn =
      level === LogLevel.ERROR ? console.error
        : level === LogLevel.WARN ? console.warn
          : console.log;

    if (data.length > 0) {
      consoleFn(prefix, message, ...data);
    } else {
      consoleFn(prefix, message);
    }

    // Accumulate for file export
    if (this._saveToFile) {
      const serialized = data.length > 0
        ? `${message} ${data.map((d) => { try { return JSON.stringify(d); } catch { return String(d); } }).join(' ')}`
        : message;

      this._entries.push({ timestamp, level, levelName, tag, message: serialized });

      if (this._entries.length > this._maxEntries) {
        this._entries = this._entries.slice(-this._maxEntries);
      }
    }
  }
}

/** Singleton logger instance */
export const log = new Logger();

// Expose on window for console debugging convenience
(window as any).ucLog = log;
