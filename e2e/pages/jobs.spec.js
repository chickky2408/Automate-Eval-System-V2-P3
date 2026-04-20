// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('Jobs Manager page', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.jobs);
  });

  test('renders the Job Management header and status columns', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Job Management/i })).toBeVisible();

    // Status lanes rendered by JobsPage (Pending / Running / Error / Completed).
    // Use role=heading so we don't collide with hidden <option> elements.
    for (const lane of ['Pending', 'Running', 'Error', 'Completed']) {
      await expect(
        page.getByRole('heading', { name: lane, exact: true }).first()
      ).toBeVisible();
    }
  });
});
