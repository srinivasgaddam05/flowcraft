import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', workers: 1, timeout: 120000, use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000', browserName: 'chromium', channel: 'chrome', headless: true, screenshot: 'only-on-failure' }, reporter: 'list', outputDir: 'artifacts/browser-tests' });
