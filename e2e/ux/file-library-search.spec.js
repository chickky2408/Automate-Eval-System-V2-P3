// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('UX — File Library page', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.fileLibrary);
  });

  test('opens, scrolls, interacts with visible controls', async ({ app, page }) => {
    await expect(page.getByRole('heading', { name: /^Library$/i })).toBeVisible();
    await app.capture('library-opened');

    const anyActionButton = page.locator('header + div button, main button')
      .filter({ hasText: /Upload|New|Add|Import|Refresh/i })
      .first();

    if (await anyActionButton.isVisible().catch(() => false)) {
      const text = (await anyActionButton.innerText()).trim();
      await anyActionButton.click().catch(() => {});
      await page.waitForTimeout(300);
      await app.capture(`clicked-${text.replace(/\s+/g, '_').slice(0, 30)}`);

      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
      await app.capture('after-escape');
    } else {
      await app.capture('no-top-action-button');
    }

    await expect(page.getByRole('heading', { name: /Something went wrong/i }))
      .toHaveCount(0);
  });
});
