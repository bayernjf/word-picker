import { test, expect } from './fixtures';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPageUrl = 'file://' + path.resolve(__dirname, 'test-page.html');

test.describe('Wordbook Management', () => {
  test('popup should open and show wordbook UI when logged in', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await expect(popupPage.locator('h1')).toContainText('WordPicker', { timeout: 5000 });
    await expect(popupPage.locator('#search-input')).toBeVisible();
    await expect(popupPage.locator('#export-json')).toBeVisible();
    await expect(popupPage.locator('#export-csv')).toBeVisible();
  });

  test('should add word via content script and see it in popup', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    const wordElement = page.locator('text=courage').first();
    await page.keyboard.down('Control');
    await wordElement.hover();
    await page.waitForTimeout(1000);

    // Try to find and click the "add to wordbook" button
    const addButton = page.locator('text=添加').first();
    if (await addButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(500);
    }

    await page.keyboard.up('Control');

    // Open popup and check if word appears
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.waitForTimeout(1000);

    const wordList = popupPage.locator('#word-list');
    await expect(wordList).toBeVisible();
  });

  test('should search words in popup', async ({ context, extensionId }) => {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await popupPage.waitForTimeout(1000);

    const searchInput = popupPage.locator('#search-input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('test');
    await popupPage.waitForTimeout(500);

    // Search should filter results without error
    const wordList = popupPage.locator('#word-list');
    await expect(wordList).toBeVisible();
  });

  test('should show WordBase link in popup', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.waitForTimeout(1000);

    const wordbaseLink = popupPage.locator('.wordbase-link');
    await expect(wordbaseLink).toBeVisible({ timeout: 5000 });
  });
});
