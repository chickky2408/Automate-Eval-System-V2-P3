// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('Dashboard page', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto();
    await app.navigateTo(PAGES.dashboard);
  });

  test('renders the system dashboard header and summary sections', async ({ page }) => {
    await expect(page.getByText(/System Dashboard/i).first()).toBeVisible();
    await expect(page.getByText(/System Summary/i).first()).toBeVisible();

    // Board fleet telemetry card(s) should be present — we just assert the
    // app didn't crash by checking at least one "boards" copy is rendered.
    const boardsMentions = page.getByText(/boards/i);
    expect(await boardsMentions.count()).toBeGreaterThan(0);
  });

  test('profile switcher and theme toggle are reachable', async ({ page }) => {
    // Header actions sit on every page; verifying here keeps the top-nav
    // regression coverage minimal but present.
    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    // At least one toggle-like button in the header.
    const headerButtons = header.getByRole('button');
    expect(await headerButtons.count()).toBeGreaterThan(0);
  });
});
