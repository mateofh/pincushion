// Logs JSON en una línea, con redacción de secretos y URLs.
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const SECRET_KEYS = /pass(word)?|token|secret|cookie|authorization|csrf|session_id|^t$/i;

/** Quita query strings y fragmentos de URLs, oculta tokens y recorta textos largos. */
export function redactString(s: string): string {
  return s
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/gi, '$1?[redactado]')
    .replace(/\bpc_[A-Za-z0-9_.-]{10,}\b/g, '[token]')
    .slice(0, 500);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '[redactado]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(
  level: Level | 'silent' = 'info',
  base: Record<string, unknown> = {},
  sink: (line: string) => void = (l) => process.stdout.write(l + '\n'),
): Logger {
  const emit = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...(redact({ ...base, ...fields }) as object) }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (f) => createLogger(level, { ...base, ...f }, sink),
  };
}
