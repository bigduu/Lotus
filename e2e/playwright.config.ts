import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Lotus E2E tests
 *
 * Usage:
 * - Browser mode: E2E_BASE_URL=http://localhost:1420 npm run test
 * - With server auto-start: E2E_START_SERVER="cargo run --manifest-path ../../bamboo/Cargo.toml --bin bamboo -- serve --port 9562 --bind 127.0.0.1 --data-dir /tmp/test-data" npm run test
 */

const suite = process.env.E2E_SUITE ?? 'all';
const testIgnore: string[] = [];

if (suite === 'browser') {
  testIgnore.push('tests/modes/desktop-mode.spec.ts');
}

const uiBaseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:1420';
const webServers: Array<{
  command: string;
  cwd: string;
  url: string;
  reuseExistingServer: boolean;
  timeout: number;
}> = [
  {
    command:
      process.env.E2E_UI_START_SERVER ||
      'npm run dev -- --host 127.0.0.1 --port 1420',
    cwd: '..',
    url: uiBaseURL,
    reuseExistingServer: true,
    timeout: 120000,
  },
];

if (process.env.E2E_START_SERVER) {
  webServers.push({
    command: process.env.E2E_START_SERVER,
    cwd: '.',
    url: 'http://127.0.0.1:9562/api/v1/health',
    reuseExistingServer: true,
    timeout: 120000,
  });
}

export default defineConfig({
  testDir: './tests',
  testIgnore,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: uiBaseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Increase timeouts for CI/slower environments
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to test other browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
  webServer: webServers,
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
});
