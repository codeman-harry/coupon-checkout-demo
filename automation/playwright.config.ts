import { defineConfig } from '@playwright/test';

// 生成稿默认示例路径为 /checkout；本 Demo 的结算页面实际位于首页。
process.env.CHECKOUT_PATH ??= '/';
const artifacts = process.env.POC_ARTIFACT_DIR || '.artifacts/manual';

// 首次验证只执行编号 8 的脚本；保留失败证据，避免自动重试掩盖 Demo 的预埋缺陷。
export default defineConfig({
  testDir: './tests',
  testMatch: 'case-8.playwright.spec.ts',
  grep: /\[8\] 小计达到 200 元时 SAVE20 减免 20 元$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: `${artifacts}/test-results`,
  reporter: [
    ['list'],
    ['junit', { outputFile: `${artifacts}/results.xml` }],
    ['json', { outputFile: `${artifacts}/playwright-results.json` }],
    ['html', { outputFolder: `${artifacts}/playwright-report`, open: 'never' }],
  ],
  use: {
    baseURL: process.env.DEMO_URL || 'http://localhost:30100',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
