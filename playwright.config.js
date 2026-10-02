// End-to-end tests: npm run test:e2e. They run against test/.build/index.html — the real
// dashboard plus the test fixtures (test/fixtures: widgets that fail on purpose, test screens)
// with every outside service mocked (test/support/mock-network.js).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.e2e.js',
  timeout: 45000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  // Service workers off by default (test/e2e/offline.e2e.js turns them on): every request stays mockable.
  use: {
    baseURL: 'http://localhost:4173',
    timezoneId: 'Europe/London',
    locale: 'en-GB',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  webServer: {
    command:
      'node scripts/build.mjs --out test/.build/index.html --widgets test/fixtures/widgets --config test/fixtures/config.js --no-syntax-check && node test/support/server.js',
    env: { OMD_ROOT: 'test/.build', OMD_PORT: '4173' },
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
