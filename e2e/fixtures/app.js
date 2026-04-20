// @ts-check
import { test as base, expect, request } from '@playwright/test';
import path from 'node:path';

export const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * Repo root → used as anchor for the screenshots directory.
 * Playwright runs specs from the project root (where playwright.config.js
 * lives), so `process.cwd()` is the stable choice. `import.meta.url` would be
 * cleaner but Playwright compiles fixtures as CommonJS.
 */
const REPO_ROOT = process.cwd();

/**
 * Where per-test screenshots land. Override with `E2E_SCREENSHOT_DIR=…` env.
 * Disable captures entirely with `E2E_SCREENSHOTS=0`.
 */
export const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR || path.join(REPO_ROOT, 'e2e', 'screenshots');
const SCREENSHOTS_ENABLED = process.env.E2E_SCREENSHOTS !== '0';

/** Sidebar labels as they appear in the UI (see frontend/src/App.jsx). */
export const PAGES = Object.freeze({
  dashboard: 'Dashboard',
  fileLibrary: 'Library',
  testCases: 'Create Test Case',
  runSet: 'Run Set',
  jobs: 'Jobs Manager',
  boards: 'Board Status',
  history: 'Test History',
  waveform: 'Realtime Waveform',
});

/**
 * Probe the backend once per run. Individual specs use
 * `test.skip(!backendUp, ...)` to stay green when only the frontend is up.
 */
let _backendUpPromise = null;
export async function isBackendUp() {
  if (!_backendUpPromise) {
    _backendUpPromise = (async () => {
      try {
        const ctx = await request.newContext();
        const res = await ctx.get(`${BACKEND_URL}/api/health`, { timeout: 3000 });
        await ctx.dispose();
        return res.ok();
      } catch {
        return false;
      }
    })();
  }
  return _backendUpPromise;
}

/** Convert a test title into a safe filename fragment. */
function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'test';
}

/**
 * Resolve the destination folder for a given test's screenshots:
 *   e2e/screenshots/<spec-path-without-.spec>/<test-title-slug>/
 * Each test gets its own subfolder so step-screenshots sit next to the final
 * one in natural ordering.
 */
function resolveShotDir(testInfo) {
  const specFile = path
    .relative(REPO_ROOT, testInfo.file)
    .replace(/\\/g, '/')
    .replace(/\.spec\.(js|ts)$/, '');
  const title = slugify(testInfo.titlePath.slice(1).join(' - '));
  return path.join(SCREENSHOT_DIR, specFile, title);
}

/**
 * Custom fixtures:
 *   - app:            helpers to navigate the SPA, plus `capture(label)` to
 *                     snapshot mid-test for UX/UI step evidence.
 *   - consoleErrors:  array collecting page console errors + page errors so a
 *                     spec can assert it stayed empty (regression safety net).
 *   - _autoScreenshot (auto): captures one final full-page PNG per test and
 *                     attaches it to the HTML report.
 *
 * Stepped screenshots (`app.capture`) use a per-test counter so files sort
 * naturally: `01_open-filters.png`, `02_selected-status.png`, …, and the
 * final auto-screenshot is written as `99_final__<status>.png`.
 */
const _stepCounter = new WeakMap();

export const test = base.extend({
  _autoScreenshot: [
    async ({ page }, use, testInfo) => {
      await use();

      if (!SCREENSHOTS_ENABLED) return;
      if (page.isClosed?.()) return;

      try {
        const dir = resolveShotDir(testInfo);
        const status = testInfo.status || 'unknown';
        const retry = testInfo.retry ? `__retry${testInfo.retry}` : '';
        const file = path.join(dir, `99_final__${status}${retry}.png`);

        await page.screenshot({ path: file, fullPage: true });
        await testInfo.attach('final', { path: file, contentType: 'image/png' });
      } catch (err) {
        console.warn('[e2e] auto-screenshot failed:', err?.message || err);
      }
    },
    { auto: true },
  ],

  consoleErrors: async ({ page }, use) => {
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      errors.push(`[pageerror] ${err.message}`);
    });
    await use(errors);
  },

  app: async ({ page, baseURL }, use, testInfo) => {
    /** Sidebar <aside> element — scopes nav clicks so we don't accidentally
     *  match page-level buttons with the same label. */
    const sidebar = () => page.locator('aside').first();

    const helpers = {
      /** Load the root SPA and wait for the sidebar header to appear. */
      async goto() {
        await page.goto(baseURL || '/', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'BOARD TEST' }))
          .toBeVisible({ timeout: 15_000 });
      },

      /**
       * Click a sidebar item by its label (see PAGES above). Scoped to the
       * sidebar <aside> so page-level buttons with similar names don't match.
       */
      async navigateTo(label) {
        const item = sidebar().getByRole('button', { name: label, exact: true }).first();
        await expect(item).toBeVisible();
        await item.click();
      },

      sidebar,

      /**
       * Snapshot the current page state mid-test. Files are auto-numbered
       * (`01_`, `02_`, …) and labelled so a reviewer can scroll through
       * `e2e/screenshots/<spec>/<test>/` and follow the interaction story.
       *
       * Also attaches the image to the HTML report so it shows inline.
       *
       * @param {string} label   short human-readable name of this UI state
       * @param {{fullPage?: boolean}} [opts]
       */
      async capture(label, opts = {}) {
        if (!SCREENSHOTS_ENABLED) return;

        const current = (_stepCounter.get(testInfo) ?? 0) + 1;
        _stepCounter.set(testInfo, current);

        const dir = resolveShotDir(testInfo);
        const seq = String(current).padStart(2, '0');
        const file = path.join(dir, `${seq}_${slugify(label)}.png`);

        try {
          await page.screenshot({ path: file, fullPage: opts.fullPage ?? true });
          await testInfo.attach(`step ${seq} — ${label}`, {
            path: file,
            contentType: 'image/png',
          });
        } catch (err) {
          console.warn(`[e2e] capture("${label}") failed:`, err?.message || err);
        }
      },
    };
    await use(helpers);
  },
});

export { expect };
