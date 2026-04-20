// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('File Library page', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.fileLibrary);
  });

  test('renders the Library heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^Library$/i })).toBeVisible();
  });
});
