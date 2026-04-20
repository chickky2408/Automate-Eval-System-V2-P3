// @ts-check
import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

/**
 * Playwright regression config for Eval System V2.
 *
 * - Frontend dev server (Vite) is started automatically on port 5173.
 * - Backend is expected to be running separately at BACKEND_URL (default
 *   http://localhost:8000). API tests are skipped gracefully if unreachable.
 *
 * Useful env vars:
 *   BASE_URL       override frontend under test (default http://localhost:5173)
 *   BACKEND_URL    backend FastAPI origin      (default http://localhost:8000)
 *   CI             enables retries + reporter tweaks when set
 *   PW_REUSE_DEV=1 skip webServer (use an already-running Vite dev server)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const reuseDev = process.env.PW_REUSE_DEV === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: {
    timeout: 7_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    extraHTTPHeaders: {
      // Tests opt-in by reading process.env.BACKEND_URL directly, but expose
      // here so traces carry it too.
      'x-e2e-backend-url': BACKEND_URL,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to expand browser coverage locally / in CI.
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',  use: { ...devices['Desktop Safari']  } },
  ],
  webServer: reuseDev
    ? undefined
    : {
        command: 'npm run dev --prefix frontend -- --host 127.0.0.1 --port 5173 --strictPort',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
