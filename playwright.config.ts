import { defineConfig, devices } from '@playwright/test';

/**
 * Browser selection.
 *
 * Default: Playwright's pinned Chromium (`npx playwright install chromium`).
 * Escape hatch for a machine that already has Chrome or Edge and would rather
 * not download 150 MB: `PW_CHANNEL=chrome npx playwright test`.
 */
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    ...(channel ? { channel } : {}),
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    // `--host 127.0.0.1` matters: without it Vite binds to `localhost`, which
    // resolves to ::1 here, and Playwright's IPv4 readiness probe never answers.
    command:
      'npm run build -w @iron/game && npm run preview -w @iron/game -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
