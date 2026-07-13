import { test, expect } from './fixtures';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPageUrl = 'file://' + path.resolve(__dirname, 'test-page.html');

test.describe('Options Page', () => {
  test('should load options page with all settings', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);

    await expect(optionsPage.locator('h1')).toContainText('WordPicker 设置', { timeout: 5000 });

    await expect(optionsPage.locator('#lookupKey')).toBeVisible();
    await expect(optionsPage.locator('#hoverDelay')).toBeVisible();
    await expect(optionsPage.locator('#translator')).toBeVisible();
    await expect(optionsPage.locator('#fireworksEffect')).toBeVisible();
    await expect(optionsPage.locator('#maxCacheSize')).toBeVisible();
  });

  test('should save settings and show status message', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);

    await optionsPage.waitForTimeout(1000);

    // Change hover delay
    const hoverDelay = optionsPage.locator('#hoverDelay');
    await hoverDelay.fill('200');

    // Submit form
    const submitButton = optionsPage.locator('button[type="submit"]');
    await submitButton.click();

    // Wait for status message
    const status = optionsPage.locator('#status');
    await expect(status).not.toBeEmpty({ timeout: 5000 });
  });

  test('should change fireworks effect setting', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);

    await optionsPage.waitForTimeout(1000);

    const fireworksSelect = optionsPage.locator('#fireworksEffect');
    await fireworksSelect.selectOption('css');
    await optionsPage.locator('button[type="submit"]').click();
    await optionsPage.waitForTimeout(1000);

    // Verify the value persists after reload
    await optionsPage.reload();
    await optionsPage.waitForTimeout(1000);
    const selectedValue = await fireworksSelect.inputValue();
    expect(selectedValue).toBe('css');
  });

  test('should change lookup key and verify it takes effect', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);

    await optionsPage.waitForTimeout(1000);

    const lookupKeySelect = optionsPage.locator('#lookupKey');
    await lookupKeySelect.selectOption('Alt');
    await optionsPage.locator('button[type="submit"]').click();
    await optionsPage.waitForTimeout(1000);

    // Reload options page to verify
    await optionsPage.reload();
    await optionsPage.waitForTimeout(1000);
    const selectedValue = await lookupKeySelect.inputValue();
    expect(selectedValue).toBe('Alt');
  });
});
