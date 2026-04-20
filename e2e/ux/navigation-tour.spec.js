// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

/**
 * A single "tour" test that walks the whole sidebar and snapshots every
 * page. Handy for UX review / documentation refresh — one test produces
 * a gallery of every top-level screen.
 */
test.describe('UX — full navigation tour', () => {
  test('captures every top-level page', async ({ app, page }) => {
    await app.goto();
    await app.capture('dashboard-initial');

    const tour = [
      { label: PAGES.fileLibrary,  key: 'library' },
      { label: PAGES.testCases,    key: 'create-test-case' },
      { label: PAGES.runSet,       key: 'run-set' },
      { label: PAGES.jobs,         key: 'jobs-manager' },
      { label: PAGES.boards,       key: 'board-status' },
      { label: PAGES.waveform,     key: 'realtime-waveform' },
      { label: PAGES.dashboard,    key: 'back-to-dashboard' },
    ];

    for (const { label, key } of tour) {
      await app.navigateTo(label);
      // Let content mount (lists, charts, etc).
      await page.waitForTimeout(400);
      await app.capture(key);

      // Keep the tour moving even if an individual page throws — the
      // regression specs will flag real failures.
      if (await page.getByRole('heading', { name: /Something went wrong/i })
        .isVisible()
        .catch(() => false)) {
        await app.capture(`${key}-error-boundary`);
        break;
      }
    }

    await expect(page.getByRole('heading', { name: 'BOARD TEST' })).toBeVisible();
  });
});
