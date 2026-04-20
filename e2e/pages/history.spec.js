// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('Test History page', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.history);
  });

  test('does not trip the app error boundary', async ({ page }) => {
    // Wait for the SPA to settle so the error boundary (if any) has
    // mounted. Otherwise `toHaveCount(0)` can pass for a crash that renders
    // microseconds later.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);

    // Explicit, high-signal assertion: if HistoryPage throws, the root
    // AppErrorBoundary (see frontend/src/main.jsx) renders an <h1> that says
    // "Something went wrong".
    await expect(
      page.getByRole('heading', { name: /Something went wrong/i })
    ).toHaveCount(0);
  });

  test('renders the Test History heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Test History/i })).toBeVisible();
  });
});
