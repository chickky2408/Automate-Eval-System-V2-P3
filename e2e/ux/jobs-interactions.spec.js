// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('UX — Jobs Manager filters', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.jobs);
  });

  test('types search, changes status, toggles tag-color popover', async ({ app, page }) => {
    await app.capture('jobs-initial');

    const search = page.getByPlaceholder(/Search by name, ID, firmware/i);
    await expect(search).toBeVisible();
    await search.fill('nonexistent-xyz');
    await app.capture('search-no-match');
    await expect(search).toHaveValue('nonexistent-xyz');
    await search.fill('');
    await app.capture('search-cleared');

    // Status filter — scoped to the visible one (FileLibraryPage stays
    // mounted in the background and has its own hidden status <select>).
    const statusSelect = page.locator('select[title="Column / Status"]').first();
    await statusSelect.selectOption('running');
    await app.capture('status-running');
    await statusSelect.selectOption('pending');
    await app.capture('status-pending');
    await statusSelect.selectOption('all');
    await app.capture('status-all');

    const tagColorBtn = page.getByRole('button', { name: /Tag color/i }).first();
    if (await tagColorBtn.isVisible().catch(() => false)) {
      await tagColorBtn.click();
      await app.capture('tag-color-dropdown');
      const searchColor = page.getByPlaceholder(/Search color/i);
      if (await searchColor.isVisible().catch(() => false)) {
        await searchColor.fill('mint');
        await app.capture('tag-color-search');
      }
      await page.keyboard.press('Escape').catch(() => {});
      await app.capture('tag-color-closed');
    }
  });
});
