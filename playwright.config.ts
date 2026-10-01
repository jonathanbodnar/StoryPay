import { defineConfig, devices } from '@playwright/test';

// Browser tests (`npm run test:browser`): real journeys clicked through on the
// test copy, at desktop and phone size. Run them with its settings:
//   railway run --service "StoryVenue Backend" --environment Dev -- npm run test:browser
const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
if (process.env.APP_ENV !== 'staging' || !base || /storyvenue\.com/.test(base)) {
  throw new Error('Browser tests run only against the test copy (railway run --environment Dev).');
}

export default defineConfig({
  testDir: './tests/browser',
  globalSetup: './tests/browser/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: base,
    // Past the test copy's password page (signed in once in global-setup).
    storageState: 'tests/browser/.auth/staging.json',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
