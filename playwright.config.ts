import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  use: {
    baseURL: 'http://127.0.0.1:5178',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5178 --strictPort',
    url: 'http://127.0.0.1:5178',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'frontend-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
