// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('UX — Dashboard System Summary filters', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.dashboard);
  });

  test('types into the name search and opens the owner dropdown', async ({ app, page }) => {
    await app.capture('dashboard-idle');

    const search = page.getByPlaceholder(/Name \(or ID\)/i);
    await expect(search).toBeVisible();
    await search.click();
    await search.fill('demo');
    await app.capture('search-typed-demo');
    await expect(search).toHaveValue('demo');

    await search.fill('');
    await app.capture('search-cleared');
    await expect(search).toHaveValue('');

    const ownerBtn = page.getByRole('button', { name: /All owners|Other clients|Default/ }).first();
    if (await ownerBtn.isVisible().catch(() => false)) {
      await ownerBtn.click();
      await app.capture('owner-dropdown-open');
      await page.keyboard.press('Escape').catch(() => {});
      await page.mouse.click(10, 10).catch(() => {});
      await app.capture('owner-dropdown-closed');
    }
  });
});
