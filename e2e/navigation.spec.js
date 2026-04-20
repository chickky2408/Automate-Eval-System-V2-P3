// @ts-check
import { test, expect, PAGES } from './fixtures/app.js';

/**
 * Navigation regression — clicks every sidebar item in turn and asserts:
 *   1. The corresponding page becomes visible (distinctive text appears).
 *   2. The in-app error boundary doesn't appear.
 *   3. No uncaught runtime errors are raised (network errors tolerated).
 */
test.describe('Sidebar navigation', () => {
  /**
   * [sidebar-label, text the target page uniquely renders once active].
   * We match on text content so tests don't break when heading levels or
   * Tailwind class names are refactored.
   */
  const cases = [
    [PAGES.dashboard, /System Dashboard|System Summary/i],
    [PAGES.fileLibrary, /^\s*Library\s*$/i],
    [PAGES.testCases, /Create Test Case/i],
    [PAGES.runSet, /^\s*Run Set\s*$/i],
    [PAGES.jobs, /Job Management/i],
    [PAGES.boards, /Fleet Manager/i],
    [PAGES.history, /Test History/i],
    [PAGES.waveform, /Realtime Waveform/i],
  ];

  for (const [label, expected] of cases) {
    test(`navigates to "${label}" without errors`, async ({ app, page, consoleErrors }) => {
      await app.goto();
      await app.navigateTo(label);

      await expect(page.getByText(expected).first()).toBeVisible({ timeout: 10_000 });

      await expect(page.getByRole('heading', { name: /Something went wrong/i }))
        .toHaveCount(0);

      const hard = consoleErrors.filter(
        (e) => !/Failed to fetch|NetworkError|ERR_CONNECTION|WebSocket/i.test(e)
      );
      expect(hard, `runtime errors on ${label}:\n${hard.join('\n')}`).toEqual([]);
    });
  }
});
