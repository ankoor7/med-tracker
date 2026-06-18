// UI interaction helpers for the E2E suite. Built on accessible locators — the
// editors expose an `aria-label` per field and the SyncIndicator exposes a
// `data-sync-phase` attribute, so the suite reads like a user's actions.

import { expect, type Page } from '@playwright/test';
import { DEV_EMAIL, DEV_PASSWORD } from './db';

export interface MedSpec {
  name: string;
  unit: string;
  halfLifeHours: number;
}

export interface SlotItemSpec {
  med: string; // medication name
  dose: number;
}

export interface SlotSpec {
  time: string; // "HH:MM"
  label?: string;
  items: SlotItemSpec[];
}

/** Switch the bottom-nav tab. */
export async function goToTab(page: Page, tab: 'Today' | 'Schedule' | 'Meds' | 'History') {
  await page.getByRole('button', { name: tab, exact: true }).click();
}

/** Sign in with the seeded dev account via the Account panel (History tab). */
export async function signIn(page: Page) {
  await goToTab(page, 'History');
  await expect(page.getByText('Account & sync')).toBeVisible();
  await page.getByLabel('Email').fill(DEV_EMAIL);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(`Signed in as`)).toBeVisible();
  await expect(page.getByText(DEV_EMAIL)).toBeVisible();
}

/** Create one medication via the Meds editor. */
export async function addMedication(page: Page, med: MedSpec) {
  await goToTab(page, 'Meds');
  await page.getByRole('button', { name: 'Add medication' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(med.name);
  await dialog.getByLabel('Unit').fill(med.unit);
  await dialog.getByLabel('Half-life hours').fill(String(med.halfLifeHours));
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  // The new card shows up in the list.
  await expect(page.getByText(med.name, { exact: true })).toBeVisible();
}

/** Create one time-slot grouping one or more medications. */
export async function addSlot(page: Page, slot: SlotSpec) {
  await goToTab(page, 'Schedule');
  await page.getByRole('button', { name: 'Add time-slot' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="time"]').fill(slot.time);
  if (slot.label) await dialog.getByPlaceholder('Morning').fill(slot.label);

  for (const item of slot.items) {
    await dialog.getByLabel('Add medication to slot').selectOption({ label: item.med });
    await dialog.getByLabel(`Dose for ${item.med}`).fill(String(item.dose));
  }

  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
}

export interface LogDoseSpec {
  med: string; // medication name (row on Today)
  dose: number; // actual amount taken (may differ from scheduled)
  /** When set, also set a one-time override for the next scheduled dose. */
  nextDose?: number;
}

/**
 * Log a dose from the Today tab. Logs the first (earliest-slot) occurrence for
 * the medication; when `nextDose` is given, enables "Adjust next … dose" and sets
 * the one-time override amount (Stage 12).
 */
export async function logDose(page: Page, spec: LogDoseSpec) {
  await goToTab(page, 'Today');
  const row = page.getByRole('listitem').filter({ hasText: spec.med }).first();
  await row.getByRole('button', { name: 'Log', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Dose', { exact: true }).fill(String(spec.dose));

  if (spec.nextDose != null) {
    await dialog.getByRole('checkbox', { name: /adjust next/i }).check();
    await dialog.getByLabel('Next dose', { exact: true }).fill(String(spec.nextDose));
  }

  await dialog.getByRole('button', { name: /log dose/i }).click();
  await expect(dialog).toBeHidden();
}

/** Trigger a sync and wait for it to settle as "synced". */
export async function syncNow(page: Page) {
  await goToTab(page, 'History');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.locator('[data-sync-phase="synced"]')).toBeVisible({ timeout: 15_000 });
}
