export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_ORDER));

function resolveLevel(): LogLevel {
  // 1. Environment variable
  const envLevel = process.env.FANTASIA_LOG_LEVEL?.toLowerCase();
  if (envLevel && VALID_LEVELS.has(envLevel)) {
    return envLevel as LogLevel;
  }

  // 2. CLI arg --log-level=<level>
  for (const arg of process.argv) {
    const match = arg.match(/^--log-level=(.+)$/);
    if (match && VALID_LEVELS.has(match[1].toLowerCase())) {
      return match[1].toLowerCase() as LogLevel;
    }
  }

  // 3. Default
  return 'info';
}

let currentLevel: LogLevel = resolveLevel();

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export interface Logger {
  trace(msg: string, ctx?: Record<string, unknown>): void;
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  fatal(msg: string, ctx?: Record<string, unknown>): void;
  child(name: string): Logger;
}

function createLogger(name: string): Logger {
  function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      name,
      msg,
    };
    if (ctx) {
      for (const [k, v] of Object.entries(ctx)) {
        entry[k] = v;
      }
    }
    console.error(JSON.stringify(entry));
  }

  return {
    trace: (msg, ctx?) => emit('trace', msg, ctx),
    debug: (msg, ctx?) => emit('debug', msg, ctx),
    info: (msg, ctx?) => emit('info', msg, ctx),
    warn: (msg, ctx?) => emit('warn', msg, ctx),
    error: (msg, ctx?) => emit('error', msg, ctx),
    fatal: (msg, ctx?) => emit('fatal', msg, ctx),
    child: (childName) => createLogger(`${name}.${childName}`),
  };
}

const logger = createLogger('server');
export default logger;
