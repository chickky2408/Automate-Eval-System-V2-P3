// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('Run Set page', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.runSet);
  });

  test('renders the Run Set heading and wizard steps', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^Run Set$/i })).toBeVisible();

    // Known section labels rendered by RunSetPage.
    await expect(page.getByText(/Test cases in library/i).first()).toBeVisible();
    await expect(page.getByText(/Set for run/i).first()).toBeVisible();
  });
});
