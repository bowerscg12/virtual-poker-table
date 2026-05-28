import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5190',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev -w @vct/game-server',
      cwd: '../..',
      port: 3010,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...process.env, GAME_SERVER_PORT: '3010' },
    },
    {
      command: 'npm run dev -w @vct/web -- --port 5190',
      cwd: '../..',
      port: 5190,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...process.env, GAME_SERVER_PORT: '3010', PORT: '5190' },
    },
  ],
});
