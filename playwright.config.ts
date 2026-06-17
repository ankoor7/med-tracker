import { defineConfig, devices } from '@playwright/test';

// Stage 10 — E2E suite. Runs a real browser against a dedicated dev server, which
// Vite boots with the local Supabase config from `.env.local` (run `pnpm local:env`
// after `pnpm local:up`). The suite uses its own port (5175) so it never collides
// with a hand-run `pnpm dev` on 5173, and sets VITE_DISABLE_SEED so the first run
// starts empty — UI actions are the only thing that reach the `records` table.
const PORT = Number(process.env.E2E_PORT ?? 5175);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // The dev account is shared across specs and each clears DB state up front,
  // so specs run serially to avoid cross-test contamination of `records`.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: baseURL,
    // Always start a fresh server so VITE_DISABLE_SEED is guaranteed in effect.
    reuseExistingServer: false,
    env: { ...process.env, VITE_DISABLE_SEED: 'true' },
    timeout: 120_000,
  },
});
