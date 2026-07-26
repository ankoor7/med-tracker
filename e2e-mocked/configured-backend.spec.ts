// Configured-backend smoke suite: the app with VITE_SUPABASE_* set, network
// calls intercepted (see helpers/mockSupabase.ts). ci.yml's main job always
// runs unconfigured, so this is the only CI coverage of the branch that used
// to crash — `useAuth` called `onAuthStateChange()` unconditionally, throwing
// `BackendNotConfiguredError` — except in reverse: that bug was in the
// *unconfigured* path, so what this suite actually guards is the sibling gap,
// that the configured path (real supabase-js client construction, sign-in,
// sign-out, sync) never got exercised by anything in CI at all.

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { mockSupabase, MOCK_EMAIL, MOCK_PASSWORD } from './helpers/mockSupabase';

async function goToHistoryTab(page: Page) {
  // Stage 20 migrated the bottom nav to React Aria Tabs: tabs now render with
  // role="tab", not role="button" (which is what this used to match).
  await page.getByRole('tab', { name: 'History', exact: true }).click();
}

async function signIn(page: Page) {
  await goToHistoryTab(page);
  await page.getByLabel('Email').fill(MOCK_EMAIL);
  await page.getByLabel('Password').fill(MOCK_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await mockSupabase(page);
});

test('loads with a configured backend and renders the account panel without crashing', async ({
  page,
}) => {
  await page.goto('/');
  await goToHistoryTab(page);

  await expect(page.getByText('Account & sync')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('signs in against the mocked backend', async ({ page }) => {
  await page.goto('/');
  await signIn(page);

  await expect(page.getByText('Signed in as')).toBeVisible();
  await expect(page.getByText(MOCK_EMAIL)).toBeVisible();
});

test('sync now round-trips through the mocked REST endpoints', async ({ page }) => {
  await page.goto('/');
  await signIn(page);
  await expect(page.getByText('Signed in as')).toBeVisible();

  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.locator('[data-sync-phase="synced"]')).toBeVisible({ timeout: 15_000 });
});

test('sign out returns to the sign-in form', async ({ page }) => {
  await page.goto('/');
  await signIn(page);
  await expect(page.getByText('Signed in as')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});
