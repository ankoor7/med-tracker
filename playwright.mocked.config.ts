import { defineConfig, devices } from '@playwright/test';
import { coverageReporter } from './playwright.coverage';

// "Configured backend" smoke suite (e2e-mocked/) — a real browser against a
// dev server booted with VITE_SUPABASE_* set, but every Supabase network call
// intercepted (see e2e-mocked/helpers/mockSupabase.ts). No Docker/Postgres
// needed, unlike the full e2e/ suite (playwright.config.ts), which is why
// this can run in CI's fast path. Own port (5176) so it never collides with
// `pnpm dev` (5173) or the real e2e suite (5175) if run alongside it.
const PORT = Number(process.env.E2E_MOCKED_PORT ?? 5176);
const baseURL = process.env.E2E_MOCKED_BASE_URL ?? `http://localhost:${PORT}`;

// `pnpm test:e2e:mocked:coverage` sets COVERAGE=true — see e2e-mocked/fixtures.ts.
const collectCoverage = process.env.COVERAGE === 'true';

export default defineConfig({
  testDir: './e2e-mocked',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: collectCoverage
    ? [['list'], coverageReporter('coverage/e2e-mocked', 'SteadyDose Configured-Backend Report')]
    : process.env.CI
      ? [['list'], ['html', { open: 'never' }]]
      : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'mock-anon-key',
      VITE_DISABLE_SEED: 'true',
    },
    timeout: 120_000,
  },
});
