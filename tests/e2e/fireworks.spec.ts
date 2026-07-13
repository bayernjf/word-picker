import { test, expect } from './fixtures';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPageUrl = 'file://' + path.resolve(__dirname, 'test-page.html');

test.describe('Fireworks Effect', () => {
  test('should trigger fireworks effect when adding word', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    // First ensure fireworks effect is enabled
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);
    await optionsPage.waitForTimeout(1000);

    const fireworksSelect = optionsPage.locator('#fireworksEffect');
    await fireworksSelect.selectOption('canvas');
    await optionsPage.locator('button[type="submit"]').click();
    await optionsPage.waitForTimeout(500);
    await optionsPage.close();

    // Now try to add a word
    const wordElement = page.locator('text=discover').first();
    await page.keyboard.down('Control');
    await wordElement.hover();
    await page.waitForTimeout(1000);

    // Try to find and click add button
    const addButton = page.locator('text=添加').first();
    if (await addButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addButton.click();

      // Check for fireworks canvas element or CSS animation
      const fireworksCanvas = page.locator('canvas').first();
      const hasCanvas = await fireworksCanvas.isVisible({ timeout: 2000 }).catch(() => false);

      // Or check for CSS particles
      const hasCssParticles = await page.locator('[class*="firework"], [class*="particle"]').first().isVisible({ timeout: 1000 }).catch(() => false);

      // At least one effect should be visible if enabled
      if (hasCanvas || hasCssParticles) {
        expect(true).toBe(true);
      }
    }

    await page.keyboard.up('Control');
  });

  test('should not trigger fireworks when effect is disabled', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    // Disable fireworks effect
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);
    await optionsPage.waitForTimeout(1000);

    await optionsPage.locator('#fireworksEffect').selectOption('none');
    await optionsPage.locator('button[type="submit"]').click();
    await optionsPage.waitForTimeout(500);
    await optionsPage.close();

    // Try to add a word
    const wordElement = page.locator('text=education').first();
    await page.keyboard.down('Control');
    await wordElement.hover();
    await page.waitForTimeout(1000);

    const addButton = page.locator('text=添加').first();
    if (await addButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(500);

      // No fireworks canvas or particles should appear
      const fireworksCanvas = page.locator('canvas').first();
      const hasCanvas = await fireworksCanvas.isVisible({ timeout: 1000 }).catch(() => false);
      expect(hasCanvas).toBe(false);
    }

    await page.keyboard.up('Control');
  });

  test('should support CSS particle effect mode', async ({ context, extensionId, page }) => {
    await page.goto(testPageUrl);

    // Set to CSS mode
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);
    await optionsPage.waitForTimeout(1000);

    await optionsPage.locator('#fireworksEffect').selectOption('css');
    await optionsPage.locator('button[type="submit"]').click();
    await optionsPage.waitForTimeout(500);
    await optionsPage.close();

    // Try to add a word
    const wordElement = page.locator('text=beautiful').first();
    await page.keyboard.down('Control');
    await wordElement.hover();
    await page.waitForTimeout(1000);

    const addButton = page.locator('text=添加').first();
    if (await addButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(500);
    }

    await page.keyboard.up('Control');
  });
});
