import { defineConfig, devices } from '@playwright/test';

/**
 * Browser selection.
 *
 * Default: Playwright's pinned Chromium (`npx playwright install chromium`).
 * Escape hatch for a machine that already has Chrome or Edge and would rather
 * not download 150 MB: `PW_CHANNEL=chrome npx playwright test`.
 */
const channel = process.env.PW_CHANNEL;

/**
 * CI has no GPU: every WebGL frame is drawn by Chromium's software
 * rasteriser (SwiftShader), where a single detailed frame can take most
 * of a second. The heavy tests legitimately need minutes there, so the
 * budgets scale with the machine instead of failing at the local wall.
 */
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: ci ? 240_000 : 90_000,
  expect: { timeout: ci ? 30_000 : 15_000 },
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
    // On the GPU-less runner, sanction software WebGL explicitly: newer
    // Chromium gates SwiftShader behind a flag, and an unsanctioned fallback
    // can kill the renderer process mid-test ("session closed").
    // --disable-dev-shm-usage is the standard CI fix for that same crash when
    // the renderer exhausts the small shared-memory mount.
    ...(ci
      ? {
          launchOptions: {
            args: ['--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
          },
        }
      : {}),
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
