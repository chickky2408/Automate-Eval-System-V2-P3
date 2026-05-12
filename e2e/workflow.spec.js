// @ts-check
import { test, expect, PAGES } from './fixtures/app.js';
import path from 'node:path';
import fs from 'node:fs';

/**
 * End-to-End Workflow Test
 * 
 * This test simulates a full user workflow:
 * 1. Uploading a VCD file to the Library.
 * 2. Creating a Test Case using the uploaded file.
 * 3. Verifying the Test Case appears in the Run Set page.
 */
test.describe('Full User Workflow', () => {
  const dummyVcdName = `test_dummy_${Date.now()}.vcd`;
  const tcName = `TC_AUTO_${Date.now()}`;

  test('should upload file and create test case', async ({ app, page }) => {
    // 0. Setup: Create a dummy VCD file for uploading
    const fixtureDir = path.join(process.cwd(), 'e2e', 'fixtures');
    if (!fs.existsSync(fixtureDir)) {
      fs.mkdirSync(fixtureDir, { recursive: true });
    }
    const dummyPath = path.join(fixtureDir, dummyVcdName);
    fs.writeFileSync(dummyPath, 'DUMMY VCD CONTENT FOR TESTING');

    // 1. Navigate to the App
    await app.goto();
    await app.capture('Dashboard Loaded');

    // 2. Go to Library and Upload File
    await app.navigateTo(PAGES.fileLibrary);
    await expect(page.getByText(/^\s*Library\s*$/i).first()).toBeVisible();
    
    // Perform upload
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(dummyPath);
    
    // Wait for success toast or file to appear
    await expect(page.getByText(/Uploaded|Success/i).first()).toBeVisible({ timeout: 15000 });
    await app.capture('File Uploaded');

    // 3. Go to Create Test Case
    await app.navigateTo(PAGES.testCases);
    await expect(page.getByText(/Create Test Case/i).first()).toBeVisible();

    // Fill in TC details
    await page.getByPlaceholder(/Test Case Name/i).fill(tcName);
    
    // Open select VCD modal/picker
    // In TestCasesPage, it uses a Library Picker modal
    const vcdSelectBtn = page.locator('button').filter({ hasText: /Select VCD/i }).first();
    await vcdSelectBtn.click();
    
    // Find our dummy file in the picker
    await page.getByText(dummyVcdName).first().click();
    await page.getByRole('button', { name: /Select/i }).click();

    // Save the Test Case
    await page.getByRole('button', { name: /Save/i }).first().click();
    await expect(page.getByText(/Saved/i).first()).toBeVisible();
    await app.capture('Test Case Created');

    // 4. Verify in Run Set
    await app.navigateTo(PAGES.runSet);
    await expect(page.getByText(/^\s*Run Set\s*$/i).first()).toBeVisible();
    
    // Check if our TC is in the list
    await expect(page.getByText(tcName).first()).toBeVisible();
    await app.capture('Verified in Run Set');
  });

  // Cleanup
  test.afterAll(async () => {
    const dummyPath = path.join(process.cwd(), 'e2e', 'fixtures', dummyVcdName);
    if (fs.existsSync(dummyPath)) {
      fs.unlinkSync(dummyPath);
    }
  });
});
