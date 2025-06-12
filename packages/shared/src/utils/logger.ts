type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  serviceName: string;
  minLevel?: LogLevel;
  console?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m'  // red
};

const RESET = '\x1b[0m';

export class Logger {
  private serviceName: string;
  private minLevel: LogLevel;
  private console: boolean;

  constructor(options: LoggerOptions) {
    this.serviceName = options.serviceName;
    this.minLevel = options.minLevel || 'info';
    this.console = options.console !== undefined ? options.console : true;
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const dataString = data ? ` ${JSON.stringify(data, null, 2)}` : '';
    const color = COLORS[level];
    const levelTag = `[${level.toUpperCase()}]`;

    return `${color}[${timestamp}] ${levelTag} [${this.serviceName}] ${message}${dataString}${RESET}`;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      const formatted = this.formatMessage('debug', message, data);
      if (this.console) console.debug(formatted);
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage('info', message, data);
      if (this.console) console.info(formatted);
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      const formatted = this.formatMessage('warn', message, data);
      if (this.console) console.warn(formatted);
    }
  }

  error(message: string, error?: Error | any): void {
    if (this.shouldLog('error')) {
      const errorData = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error;

      const formatted = this.formatMessage('error', message, errorData);
      if (this.console) console.error(formatted);
    }
  }

  // Timer utility
  startTimer(operation: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.debug(`Operation '${operation}' completed in ${duration}ms`);
    };
  }
}

// Exported factory
export const createLogger = (serviceName: string, options: Partial<LoggerOptions> = {}): Logger => {
  return new Logger({
    serviceName,
    ...options
  });
};
