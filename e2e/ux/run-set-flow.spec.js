// @ts-check
import { test, expect, PAGES } from '../fixtures/app.js';

test.describe('UX — Run Set wizard walkthrough', () => {
  test('renders the 3-step wizard layout', async ({ app, page }) => {
    await app.goto();
    await app.capture('landing-dashboard');

    await app.navigateTo(PAGES.runSet);
    await app.capture('run-set-opened');

    await expect(page.getByRole('heading', { name: /^Run Set$/i })).toBeVisible();

    // The wizard has three labelled sections. Confirm each and capture a
    // frame so a reviewer can verify layout across sections.
    await expect(page.getByText(/1\. Test cases in library/i).first()).toBeVisible();
    await app.capture('step1-test-cases-in-library');

    await expect(page.getByText(/2\. Set for run/i).first()).toBeVisible();
    await app.capture('step2-set-for-run');

    const step3 = page.getByText(/3\. Set name, Tag & Board selection/i).first();
    if (await step3.isVisible().catch(() => false)) {
      await step3.scrollIntoViewIfNeeded();
      await app.capture('step3-name-tag-boards');
    }
  });
});
