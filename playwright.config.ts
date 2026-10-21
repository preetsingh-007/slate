import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Use a preinstalled Chromium when available (sandboxed environments); otherwise Playwright's own.
const candidate = process.env.SLATE_CHROMIUM ?? '/opt/pw-browsers/chromium';
const executablePath = existsSync(candidate) ? candidate : undefined;
// Ports can be changed so several checkouts can run their tests at once.
const appPort = Number(process.env.SLATE_E2E_APP_PORT ?? 4173);
const apiPort = Number(process.env.SLATE_E2E_API_PORT ?? 4455);
process.env.SLATE_E2E_API = `http://localhost:${apiPort}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${appPort}`,
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } },
    {
      name: 'tablet',
      use: { ...devices['iPad Pro 11'], browserName: 'chromium', hasTouch: true, launchOptions: { executablePath } },
      grep: /@touch/,
    },
  ],
  webServer: [
    { command: `SLATE_E2E=1 npm run build && npx vite preview --port ${appPort} --strictPort`, port: appPort, reuseExistingServer: !process.env.CI, timeout: 180_000 },
    { command: `node tests/e2e/server.mjs --port ${apiPort}`, port: apiPort, reuseExistingServer: !process.env.CI },
  ],
});
