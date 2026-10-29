/**
 * Debug logging for the userscript.
 *
 * Kept free of project imports so any module — including ones that utils itself
 * depends on, like integrationRegistry — can log without creating an import cycle.
 * Most code should keep importing `debugLog` from `./utils`, which re-exports it.
 */

/**
 * Formats the current time as a timestamp string
 */
function formatTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * Debug logging function
 */
export function debugLog(...args: unknown[]): void {
  const level: LogLevel = args.length > 0 && typeof args[args.length - 1] === 'string'
    && ['debug', 'info', 'warning', 'error'].includes(args[args.length - 1] as string)
    ? args.pop() as LogLevel : 'debug';

  const currentLogLevel = GM_getValue('debug_log_level', 'info') as string;
  const logLevels: Record<string, number> = {
    debug: 0, info: 1, warning: 2, error: 3,
  };

  // Only log if the message level is at or above the current log level
  if (logLevels[level] >= logLevels[currentLogLevel]) {
    const timestamp = `[${formatTimestamp()}]`;
    const prefix = `${timestamp}[${level.toUpperCase()}][Monarch Uploader]`;

    if (level === 'error') {
      console.error(prefix, ...args);
    } else if (level === 'warning') {
      console.warn(prefix, ...args);
    } else if (level === 'info') {
      console.info(prefix, ...args);
    } else {
      console.log(prefix, ...args);
    }
  }
}

