// @ts-check
import { test, expect } from './fixtures/app.js';

/**
 * Smoke test — verifies the SPA boots without throwing uncaught errors and
 * renders the main shell (sidebar + default dashboard page).
 */
test.describe('SPA smoke', () => {
  test('loads the app shell without runtime errors', async ({ app, page, consoleErrors }) => {
    await app.goto();

    // Sidebar is visible with branding.
    await expect(page.getByRole('heading', { name: 'BOARD TEST' })).toBeVisible();
    await expect(page.getByText(/Enterprise v2\.0/i)).toBeVisible();

    // Main content should be present.
    await expect(page.locator('main, [role="main"]').first()).toBeVisible();

    // The in-app error boundary must NOT be rendered.
    await expect(page.getByRole('heading', { name: /Something went wrong/i }))
      .toHaveCount(0);

    // No uncaught page errors (ignore noisy network fetch errors to the
    // backend when it's not running).
    const hard = consoleErrors.filter((e) => !/Failed to fetch|NetworkError|ERR_CONNECTION/i.test(e));
    expect(hard, `unexpected runtime errors:\n${hard.join('\n')}`).toEqual([]);
  });

  test('has no hydration / boundary crash on reload', async ({ app, page }) => {
    await app.goto();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'BOARD TEST' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Something went wrong/i }))
      .toHaveCount(0);
  });
});
