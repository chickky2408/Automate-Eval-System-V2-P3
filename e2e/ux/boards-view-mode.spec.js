// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('UX — Board Status grid/list + filters', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.boards);
  });

  test('switches view mode and filters by status', async ({ app, page }) => {
    await app.capture('boards-grid-default');

    // Status filter — pick the visible one. FileLibrary stays mounted in
    // the background with its own hidden <select>, so we need :visible.
    const statusSelect = page.locator('select:visible').first();
    if ((await statusSelect.count()) > 0) {
      const firstOpt = await statusSelect
        .locator('option')
        .nth(1) // skip "All Status"
        .getAttribute('value');
      if (firstOpt) {
        await statusSelect.selectOption(firstOpt);
        await app.capture(`filter-status-${firstOpt}`);
        await statusSelect.selectOption('');
        await app.capture('filter-status-cleared');
      }
    }

    const refresh = page.getByRole('button', { name: /Refresh/i });
    if (await refresh.isVisible().catch(() => false)) {
      await refresh.click();
      await page.waitForTimeout(300);
      await app.capture('after-refresh');
    }

    await expect(page.getByRole('heading', { name: /Something went wrong/i }))
      .toHaveCount(0);
  });
});
