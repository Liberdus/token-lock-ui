import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: {
        baseURL: 'http://127.0.0.1:4173',
        headless: true,
        launchOptions: process.env.PW_SLOW_MO
          ? { slowMo: Number(process.env.PW_SLOW_MO) }
          : undefined,
      },
    },
  ],
});
