// @ts-check
import { test, expect } from '../fixtures/app.js';

/**
 * UX: header theme toggle.
 * Captures the full page before/after clicking so a reviewer can confirm
 * the dark/light palette actually swaps everywhere.
 */
test.describe('UX — theme toggle', () => {
  test('switches between dark and light palettes', async ({ app, page }) => {
    await app.goto();
    await app.capture('initial-theme');

    const html = page.locator('html');
    const before = (await html.getAttribute('class')) || '';
    const wasDark = before.includes('dark');

    // The header theme button renders just an emoji (☀/🌙), so its only
    // accessible signal is the `title` attribute that flips between
    // "Switch to light mode" / "Switch to dark mode".
    const toggle = page.locator('header button[title*="Switch to"]').first();
    await expect(toggle).toBeVisible();
    await toggle.click();
    await app.capture('after-first-toggle');

    const after = (await html.getAttribute('class')) || '';
    expect(
      after.includes('dark') !== wasDark,
      `<html> class should flip the "dark" modifier (before="${before}", after="${after}")`
    ).toBeTruthy();

    // Toggle back so the theme is restored for other tests that share state.
    await toggle.click();
    await app.capture('after-second-toggle');

    const restored = (await html.getAttribute('class')) || '';
    expect(restored.includes('dark')).toBe(wasDark);
  });
});
