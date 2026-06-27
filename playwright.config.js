import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // 30s per test / 10s per assertion: the genome grids (detail / trio / diff)
  // render ~2304 cells and compute asynchronously, so opening a pet detail or a
  // diff can take several seconds under CPU contention on shared CI runners.
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  retries: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    port: 5174,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
