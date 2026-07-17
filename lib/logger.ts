export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'warn';
let initialized = false;
let initPromise: Promise<void> | null = null;

async function loadLevelFromStorage(): Promise<void> {
  if (initialized) return;
  if (initPromise) {
    await initPromise;
    return;
  }
  initPromise = (async () => {
    try {
      const storage = await import('./storage.js');
      const settings = await storage.getSettings();
      if (settings.logLevel && settings.logLevel in LEVEL_PRIORITY) {
        minLevel = settings.logLevel;
      }
    } catch {
      // ignore, keep default
    }
    initialized = true;
  })();
  await initPromise;
}

export function setLogLevel(level: LogLevel): void {
  if (level in LEVEL_PRIORITY) {
    minLevel = level;
  }
}

export function getLogLevel(): LogLevel {
  return minLevel;
}

function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatTime(): string {
  const now = new Date();
  return (
    now.toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' +
    String(now.getMilliseconds()).padStart(3, '0')
  );
}

function safeStringify(obj: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}

function formatArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg instanceof Error) {
      return arg.stack || arg.message;
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        return safeStringify(arg);
      } catch {
        return String(arg);
      }
    }
    return arg;
  });
}

export class Logger {
  private ns: string;

  constructor(namespace: string) {
    this.ns = namespace;
  }

  debug(...args: unknown[]): void {
    if (!isLevelEnabled('debug')) return;
    console.debug(`[${formatTime()}] [${this.ns}] [DEBUG]`, ...formatArgs(args));
  }

  info(...args: unknown[]): void {
    if (!isLevelEnabled('info')) return;
    console.info(`[${formatTime()}] [${this.ns}] [INFO]`, ...formatArgs(args));
  }

  warn(...args: unknown[]): void {
    if (!isLevelEnabled('warn')) return;
    console.warn(`[${formatTime()}] [${this.ns}] [WARN]`, ...formatArgs(args));
  }

  error(...args: unknown[]): void {
    if (!isLevelEnabled('error')) return;
    console.error(`[${formatTime()}] [${this.ns}] [ERROR]`, ...formatArgs(args));
  }
}

export function createLogger(namespace: string): Logger {
  void loadLevelFromStorage();
  return new Logger(namespace);
}
