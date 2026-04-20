// @ts-check
import { test, expect } from '../fixtures/app.js';

test.describe('UX — sidebar collapse/expand', () => {
  test('collapses to an icon strip and restores on second click', async ({ app, page }) => {
    await app.goto();

    const sidebar = app.sidebar();
    // Toggle button sits at the top of the sidebar and has no accessible name
    // — grab it by role/position inside the aside.
    const toggle = sidebar.getByRole('button').first();

    const expandedWidth = (await sidebar.boundingBox())?.width || 0;
    await app.capture('sidebar-expanded');
    expect(expandedWidth).toBeGreaterThan(180);

    await toggle.click();
    // Allow the CSS transition to settle before measuring.
    await page.waitForTimeout(350);
    const collapsedWidth = (await sidebar.boundingBox())?.width || 0;
    await app.capture('sidebar-collapsed');
    expect(
      collapsedWidth,
      `sidebar should shrink below expanded (${expandedWidth}) after toggle; got ${collapsedWidth}`
    ).toBeLessThan(expandedWidth);

    await toggle.click();
    await page.waitForTimeout(350);
    const restoredWidth = (await sidebar.boundingBox())?.width || 0;
    await app.capture('sidebar-restored');
    expect(restoredWidth).toBeGreaterThanOrEqual(expandedWidth - 2);
  });
});
