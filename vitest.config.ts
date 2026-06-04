import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Pin the timezone so tests that evaluate server-local time (the daily digest gate,
    // quiet hours) are deterministic across dev machines and CI (GitHub runners are UTC).
    env: { TZ: 'UTC' },
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/db/index.ts', 'src/lib/db/test-helpers.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
