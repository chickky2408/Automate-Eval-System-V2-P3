// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('Create Test Case page', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.testCases);
  });

  test('renders the Create Test Case heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Create Test Case/i })).toBeVisible();
  });
});
