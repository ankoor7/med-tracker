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
export async function goToTab(
  page: Page,
  tab: 'Today' | 'Calendar' | 'Meds' | 'Events' | 'History',
) {
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
  await page.getByRole('button', { name: 'By medication' }).click();
  await page.getByRole('button', { name: 'Add medication' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(med.name);
  await dialog.getByLabel('Unit').fill(med.unit);
  await dialog.getByLabel('Half-life hours').fill(String(med.halfLifeHours));
  // Times live on the medication now (FR-18.12). This helper creates the
  // medication only; `addSlot` below schedules it from the by-time view, so
  // drop the blank starter row to keep the two helpers independent.
  await dialog.getByRole('button', { name: 'Remove dose 1' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  // The new card shows up in the list.
  await expect(page.getByText(med.name, { exact: true })).toBeVisible();
}

/** Create one time-slot grouping one or more medications. */
export async function addSlot(page: Page, slot: SlotSpec) {
  await goToTab(page, 'Meds');
  await page.getByRole('button', { name: 'By time' }).click();
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

// ---- Events / flare-up tracking (Stage 15) ----------------------------------

export interface EventPropSpec {
  name: string;
  type: 'number' | 'text' | 'scale' | 'duration';
  min?: number;
  max?: number;
}

export interface EventTypeSpec {
  name: string;
  /**
   * Properties to add on top of the two seeded defaults (Severity scale + Duration).
   * Their record-side ids are generated, so tests look them up by name on the
   * persisted `eventType.properties` array.
   */
  extraProps?: EventPropSpec[];
}

/** Define an event type via the Events editor (keeps the seeded Severity + Duration). */
export async function addEventType(page: Page, spec: EventTypeSpec) {
  await goToTab(page, 'Events');
  await page.getByRole('button', { name: 'New type', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Event type name').fill(spec.name);

  for (const prop of spec.extraProps ?? []) {
    await dialog.getByRole('button', { name: 'Add property' }).click();
    // The newly-appended row is always the last of each repeated field.
    await dialog.getByLabel('Property name').last().fill(prop.name);
    await dialog.getByLabel('Property type').last().selectOption(prop.type);
    if (prop.type === 'scale') {
      if (prop.min != null) await dialog.getByLabel('Scale min').last().fill(String(prop.min));
      if (prop.max != null) await dialog.getByLabel('Scale max').last().fill(String(prop.max));
    }
  }

  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(spec.name, { exact: true })).toBeVisible();
}

export interface LogEventSpec {
  type: string; // event type name
  /** Property name -> value, as typed into each field (e.g. { Severity: 4, Duration: 90 }). */
  values?: Record<string, string | number>;
  note?: string;
}

/** Log an occurrence of an event type from the Events tab. */
export async function logEvent(page: Page, spec: LogEventSpec) {
  await goToTab(page, 'Events');
  await page.getByRole('button', { name: 'Log event', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Event type', { exact: true }).selectOption({ label: spec.type });

  for (const [name, value] of Object.entries(spec.values ?? {})) {
    await dialog.getByLabel(name, { exact: true }).fill(String(value));
  }
  if (spec.note != null) await dialog.getByLabel('Note', { exact: true }).fill(spec.note);

  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Archive an event type by name (event types are never deleted). The active types
 * list is rendered before the archived list and history, so the first matching row
 * is the active type's row; archiving moves it into the "Archived types" section
 * where an Unarchive control appears.
 */
export async function archiveEventType(page: Page, name: string) {
  await goToTab(page, 'Events');
  const row = page.getByRole('listitem').filter({ hasText: name }).first();
  await row.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Unarchive' }),
  ).toBeVisible();
}

/** Restore an archived event type by name back into the active list. */
export async function unarchiveEventType(page: Page, name: string) {
  await goToTab(page, 'Events');
  const row = page.getByRole('listitem').filter({ hasText: name }).first();
  await row.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Archive' }),
  ).toBeVisible();
}

/** Trigger a sync and wait for it to settle as "synced". */
export async function syncNow(page: Page) {
  await goToTab(page, 'History');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.locator('[data-sync-phase="synced"]')).toBeVisible({ timeout: 15_000 });
}
