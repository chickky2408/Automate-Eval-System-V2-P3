// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('Board Status page', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.boards);
  });

  test('renders the Fleet Manager heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Fleet Manager/i })).toBeVisible();
  });

  test('page has no error boundary after load', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Something went wrong/i }))
      .toHaveCount(0);
  });
});
