// Before/after screenshots of every screen, for checking a refactor pixel by pixel.
//   npm run test:visual -- --update-snapshots   (on the old code: records the baseline)
//   npm run test:visual                          (on your change: compares against it)
// Snapshots are machine-specific (fonts), so they stay out of git.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/visual',
  testMatch: '*.visual.js',
  snapshotPathTemplate: '{testDir}/__screens__/{arg}{ext}',
  timeout: 60000,
  fullyParallel: true,
  reporter: [['list']],
  expect: { toMatchSnapshot: { maxDiffPixelRatio: 0 } },
  use: { baseURL: 'http://localhost:4174', timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: 'dark' },
  webServer: {
    command: 'node test/support/server.js',
    env: { OMD_PORT: '4174', OMD_ROOT: process.env.OMD_ROOT || 'public' },
    port: 4174,
    reuseExistingServer: false,
  },
});
