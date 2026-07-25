// Network-level Supabase mock for the "configured backend" E2E smoke suite.
//
// `ci.yml`'s main test/build job always runs with VITE_SUPABASE_* unset (the
// local-first default), so nothing in CI ever exercised the app with a
// backend *configured* — the exact branch that crashed when `useAuth` called
// `onAuthStateChange()` unconditionally (see AccountPanel.test.tsx). Booting a
// real Supabase stack here would need Docker + migrations just to prove the
// client wires up; intercepting the handful of HTTP calls the app actually
// makes is enough to catch that class of bug without it, and runs in any CI
// environment. `playwright.mocked.config.ts` points VITE_SUPABASE_URL at a
// dummy, never-dialed host — every request the app makes is expected to be
// caught by one of the routes registered here.

import type { Page, Route } from '@playwright/test';

export const MOCK_EMAIL = 'mock@steadydose.local';
export const MOCK_PASSWORD = 'mock-password';

const MOCK_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: MOCK_EMAIL,
  email_confirmed_at: '2026-01-01T00:00:00Z',
  phone: '',
  confirmed_at: '2026-01-01T00:00:00Z',
  last_sign_in_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function tokenResponse() {
  return {
    access_token: 'mock-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'mock-refresh-token',
    user: MOCK_USER,
  };
}

async function handleAuth(route: Route) {
  const url = new URL(route.request().url());

  if (url.pathname.endsWith('/auth/v1/token')) {
    // signInWithPassword and the post-refresh token dance both land here,
    // distinguished by ?grant_type=. Both succeed with the same mock session.
    await route.fulfill({ status: 200, json: tokenResponse() });
    return;
  }
  if (url.pathname.endsWith('/auth/v1/logout')) {
    await route.fulfill({ status: 204, body: '' });
    return;
  }
  // Unanticipated GoTrue call: fail loudly and specifically rather than
  // hanging the test until Playwright's action timeout.
  await route.fulfill({
    status: 501,
    json: {
      message: `mockSupabase: unhandled auth request ${route.request().method()} ${url.pathname}`,
    },
  });
}

async function handleRest(route: Route) {
  const url = new URL(route.request().url());
  const method = route.request().method();

  if (url.pathname.endsWith('/rest/v1/records') && method === 'GET') {
    // PostgREST returns a bare array for a select; empty pull, nothing to merge.
    await route.fulfill({
      status: 200,
      headers: { 'content-range': '0-0/0' },
      json: [],
    });
    return;
  }
  if (url.pathname.endsWith('/rest/v1/rpc/push_records') && method === 'POST') {
    const body = route.request().postDataJSON() as { changes?: Array<{ id: string }> };
    const results = (body.changes ?? []).map((c) => ({ id: c.id, accepted: true }));
    await route.fulfill({ status: 200, json: results });
    return;
  }
  await route.fulfill({
    status: 501,
    json: { message: `mockSupabase: unhandled rest request ${method} ${url.pathname}` },
  });
}

/** Register the auth + REST route interceptors. Call before `page.goto('/')`. */
export async function mockSupabase(page: Page): Promise<void> {
  await page.route('**/auth/v1/**', handleAuth);
  await page.route('**/rest/v1/**', handleRest);
}
