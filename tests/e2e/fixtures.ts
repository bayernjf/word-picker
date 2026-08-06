import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '../../dist/chrome');

export type ExtensionFixture = {
  extensionId: string;
  context: BrowserContext;
  loggedInContext: BrowserContext;
};

// 测试账号通过环境变量注入，不硬编码凭证
const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '';

if (!TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error('E2E 测试需要设置 TEST_EMAIL 和 TEST_PASSWORD 环境变量');
}

export const test = base.extend<ExtensionFixture>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }
    const extensionId = serviceWorker.url().split('/')[2];
    await use(extensionId);
  },
  // 自动登录 fixture
  loggedInContext: [async ({ context, extensionId }, use) => {
    // 先打开设置页进行登录
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);
    await optionsPage.waitForTimeout(2000);

    // 检查是否已经登录（之前测试可能已登录）
    const authEmailVisible = await optionsPage.locator('#authEmail').isVisible().catch(() => false);
    if (authEmailVisible) {
      // 未登录，执行登录流程
      await optionsPage.locator('#authEmail').fill(TEST_EMAIL);
      await optionsPage.locator('#authPassword').fill(TEST_PASSWORD);
      await optionsPage.locator('#auth-login').click();

      // 等待登录成功：优先等待 auth-logged-in 可见，fallback 等待成功提示文字
      try {
        await optionsPage.locator('#auth-logged-in').waitFor({ state: 'visible', timeout: 10000 });
      } catch {
        await optionsPage.locator('text=登录成功').waitFor({ state: 'visible', timeout: 10000 });
        await optionsPage.waitForTimeout(3000);
      }
    }
    // 已登录则直接使用

    await optionsPage.waitForTimeout(1000);

    // 关闭设置页，登录状态已保存在 extension 中
    await optionsPage.close();

    // 使用已登录的 context 运行测试
    await use(context);
  }, { auto: true }],
});

export const expect = test.expect;
