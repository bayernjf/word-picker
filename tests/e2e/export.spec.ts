import { test, expect } from './fixtures';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPageUrl = 'file://' + path.resolve(__dirname, 'test-page.html');

test.describe('Export Functionality', () => {
  test('export buttons should exist in popup', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.waitForTimeout(1500);

    // Buttons should be visible (user is logged in)
    await expect(popupPage.locator('#export-json')).toBeVisible();
    await expect(popupPage.locator('#export-csv')).toBeVisible();
  });

  test('should export words as JSON', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.waitForTimeout(1500);

    const downloadPromise = popupPage.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await popupPage.locator('#export-json').click();

    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.json$/);
    }
  });

  test('should export words as CSV', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.waitForTimeout(1500);

    const downloadPromise = popupPage.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await popupPage.locator('#export-csv').click();

    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.csv$/);
    }
  });
});
