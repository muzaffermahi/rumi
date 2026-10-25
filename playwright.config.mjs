// End-to-end tests: a real browser against a real Rumi server and the scripted fake model (no API keys).
// `npm run test:e2e`. SCREENSHOTS=1 also refreshes the README screenshots in docs/.
import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {viewport: {width: 1360, height: 860}, trace: 'retain-on-failure'},
  // RUMI_E2E_BROWSER points at a Chromium you already have, instead of Playwright's own download.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: {width: 1360, height: 860},
        launchOptions: process.env.RUMI_E2E_BROWSER ? {executablePath: process.env.RUMI_E2E_BROWSER} : {},
      },
    },
  ],
});
