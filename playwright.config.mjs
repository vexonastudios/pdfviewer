import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5245', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/preview-server.mjs', url: 'http://127.0.0.1:5245', reuseExistingServer: false },
});
