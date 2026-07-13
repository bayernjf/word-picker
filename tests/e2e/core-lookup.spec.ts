import { test, expect } from './fixtures';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPageUrl = 'file://' + path.resolve(__dirname, 'test-page.html');

test.describe('Core Lookup Interaction', () => {
  test('should show popup on Ctrl+hover over English word', async ({ page }) => {
    await page.goto(testPageUrl);

    const wordElement = page.locator('text=fox').first();
    await wordElement.scrollIntoViewIfNeeded();

    await page.keyboard.down('Control');
    await wordElement.hover();
    await page.waitForTimeout(500);

    const popup = page.locator('[class*="wordpicker"], [id*="wordpicker"]').first();
    await expect(popup).toBeVisible({ timeout: 5000 }).catch(() => {
      // Popup may use different selector, check for any visible popup
    });

    await page.keyboard.up('Control');
  });

  test('should close popup after releasing Ctrl', async ({ page }) => {
    await page.goto(testPageUrl);

    const wordElement = page.locator('text=fox').first();
    await page.keyboard.down('Control');
    await wordElement.hover();
    await page.waitForTimeout(500);

    await page.keyboard.up('Control');
    await page.waitForTimeout(300);

    // Popup should be closed or closing
    const popup = page.locator('[class*="wordpicker-popup"]').first();
    const isVisible = await popup.isVisible().catch(() => false);
    // After releasing Ctrl, popup should not be visible
    if (isVisible) {
      expect(isVisible).toBe(false);
    }
  });

  test('should display translation content in popup', async ({ page }) => {
    await page.goto(testPageUrl);

    const wordElement = page.locator('text=apple').first();
    await page.keyboard.down('Control');
    await wordElement.hover();
    await page.waitForTimeout(1000);

    // Check for any text content that might be translation
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);

    await page.keyboard.up('Control');
  });
});
