import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 15_000,
    env: {
      APP_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
      APP_ORIGIN: 'http://localhost:4321',
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      JOBS_INLINE_WORKER: 'false',
    },
  },
});
