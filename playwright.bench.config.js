// Performance numbers for before/after comparisons: npm run bench (prints a table, writes
// test/.bench/<label>.json). Not part of CI — timings depend on the machine. The CI keeps
// the deterministic budgets in test/e2e/perf.e2e.js instead.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/bench',
  testMatch: '*.bench.js',
  timeout: 180000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4175', timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: 'dark' },
  webServer: {
    command:
      'node scripts/build.mjs --out test/.build/index.html --widgets test/fixtures/widgets --config test/fixtures/config.js --no-syntax-check && node test/support/server.js',
    env: { OMD_ROOT: 'test/.build', OMD_PORT: '4175' },
    port: 4175,
    reuseExistingServer: false,
  },
});
