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

export default defineConfig({
  testDir: './tests',
  testIgnore,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:9562',
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
  // Only use webServer if E2E_START_SERVER is set
  ...(process.env.E2E_START_SERVER ? {
    webServer: {
      command: process.env.E2E_START_SERVER,
      cwd: '.', // Run from lotus/e2e so ../../bamboo/Cargo.toml resolves correctly
      url: 'http://localhost:9562/api/v1/health',
      reuseExistingServer: false,
      timeout: 120000,
    },
  } : {}),
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
});
