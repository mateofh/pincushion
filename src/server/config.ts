// Configuración leída y validada una sola vez desde el entorno.
import { z } from 'astro/zod';

const bool = z.enum(['0', '1', 'true', 'false']).transform((v) => v === '1' || v === 'true');

const schema = z.object({
  APP_ORIGIN: z.string().url().default('http://localhost:4321'),
  APP_SECRET: z.string().min(32, 'APP_SECRET debe tener al menos 32 caracteres'),
  DATABASE_PATH: z.string().min(1).default('./data/pincushion.db'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4321),
  HOST: z.string().default('127.0.0.1'),
  TRUST_PROXY: bool.default(false),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  JOBS_INLINE_WORKER: bool.default(true),
  METADATA_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(8000),
  METADATA_MAX_BYTES: z.coerce.number().int().min(10000).max(10_000_000).default(1_500_000),
  EXCERPT_MAX_CHARS: z.coerce.number().int().min(200).max(8000).default(8000),
  RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().min(1).max(10000).default(5),
  PINCUSHION_TEST_MODE: bool.default(false),
  /** Solo con PINCUSHION_TEST_MODE: host:puerto locales que el fetcher puede visitar (separados por coma). */
  METADATA_TEST_HOSTS: z.string().default(''),
});

export type Config = z.infer<typeof schema> & {
  /** Cookies Secure/__Host- cuando APP_ORIGIN es https (no depende de NODE_ENV). */
  secureCookies: boolean;
  testHosts: Set<string>;
};

let dotenvLoaded = false;

/** Carga ./.env (si existe) en process.env sin pisar variables ya definidas. Una vez por proceso. */
export function loadDotEnv(path = '.env'): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export function loadConfig(env?: Record<string, string | undefined>): Config {
  if (!env) {
    if (process.env.NODE_ENV !== 'test') loadDotEnv();
    env = process.env;
  }
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${issues}`);
  }
  const c = parsed.data;
  const origin = new URL(c.APP_ORIGIN);
  return {
    ...c,
    APP_ORIGIN: origin.origin,
    secureCookies: origin.protocol === 'https:',
    testHosts: new Set(
      c.PINCUSHION_TEST_MODE ? c.METADATA_TEST_HOSTS.split(',').map((s) => s.trim()).filter(Boolean) : [],
    ),
  };
}
