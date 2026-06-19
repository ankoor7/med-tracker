// Stage 15 E2E: health-condition / flare-up event tracking.
//
// A user defines a custom event type (with a severity scale, a duration, and an
// extra custom property), logs an occurrence, then later archives the type. We
// assert the resulting `eventType` and `eventInstance` rows in Supabase, proving
// the full UI -> store -> sync -> push_records RPC -> Postgres round-trip — and
// that archiving a type is a reversible, non-destructive flag (never a tombstone)
// while its logged instances survive untouched.

import { test, expect } from '@playwright/test';
import {
  addEventType,
  archiveEventType,
  logEvent,
  signIn,
  syncNow,
  unarchiveEventType,
} from './helpers/app';
import { getRecords, getUserId, clearUserRecords, closePool } from './helpers/db';

interface PropertyDef {
  id: string;
  name: string;
  type: 'number' | 'text' | 'scale' | 'duration';
  min?: number;
  max?: number;
}

let userId: string;

test.beforeAll(async () => {
  userId = await getUserId();
});

test.beforeEach(async () => {
  await clearUserRecords(userId);
});

test.afterAll(async () => {
  await closePool();
});

test('defines a custom event type and logs an occurrence that syncs to Supabase', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page);

  // A "Seizure" type keeps the two seeded properties (Severity scale 1–5, Duration)
  // and adds a free-text "Trigger" property to exercise custom property defs.
  await addEventType(page, {
    name: 'Seizure',
    extraProps: [{ name: 'Trigger', type: 'text' }],
  });

  await logEvent(page, {
    type: 'Seizure',
    values: { Severity: 4, Duration: 90, Trigger: 'Stress' },
    note: 'evening episode',
  });

  await syncNow(page);

  // The event type persisted with its property schema.
  await expect
    .poll(async () => (await getRecords(userId, 'eventType')).length, { timeout: 15_000 })
    .toBe(1);
  const [typeRow] = await getRecords(userId, 'eventType');
  expect(typeRow!.payload.name).toBe('Seizure');

  const props = typeRow!.payload.properties as PropertyDef[];
  const severity = props.find((p) => p.id === 'severity');
  const duration = props.find((p) => p.id === 'duration');
  const trigger = props.find((p) => p.name === 'Trigger');
  expect(severity).toMatchObject({ type: 'scale', min: 1, max: 5 });
  expect(duration).toMatchObject({ type: 'duration' });
  expect(trigger).toMatchObject({ type: 'text' });

  // The logged instance persisted, linked to its type, with values keyed by
  // property id (seeded ids are stable; the custom one is generated).
  await expect
    .poll(async () => (await getRecords(userId, 'eventInstance')).length, { timeout: 15_000 })
    .toBe(1);
  const [inst] = await getRecords(userId, 'eventInstance');
  expect(inst!.payload.typeId).toBe(typeRow!.id);

  const values = inst!.payload.values as Record<string, unknown>;
  expect(values.severity).toBe(4);
  expect(values.duration).toBe(90);
  expect(values[trigger!.id]).toBe('Stress');

  expect(typeof inst!.payload.occurredAt).toBe('number');
  expect(Number(inst!.payload.occurredAt)).toBeGreaterThan(0);
  expect(inst!.payload.zone).toBeTruthy();
  expect(inst!.payload.note).toBe('evening episode');
});

test('archiving an event type is reversible and keeps it (and its instances) intact', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page);

  await addEventType(page, { name: 'Migraine' });
  await logEvent(page, { type: 'Migraine', values: { Severity: 3, Duration: 120 } });
  await syncNow(page);

  await expect
    .poll(async () => (await getRecords(userId, 'eventInstance')).length, { timeout: 15_000 })
    .toBe(1);
  const [instBefore] = await getRecords(userId, 'eventInstance');

  // Archive: the type stays a live record flagged archived — never tombstoned.
  await archiveEventType(page, 'Migraine');
  await syncNow(page);

  await expect
    .poll(async () => (await getRecords(userId, 'eventType'))[0]?.payload.archived, {
      timeout: 15_000,
    })
    .toBe(true);
  const [typeRow] = await getRecords(userId, 'eventType');
  expect(typeRow!.deleted).toBeFalsy(); // archived, not deleted

  // The logged instance is preserved, untouched.
  const instances = await getRecords(userId, 'eventInstance');
  expect(instances).toHaveLength(1);
  expect(instances[0]!.id).toBe(instBefore!.id);
  expect(instances[0]!.deleted).toBeFalsy();

  // Unarchive: the flag clears and the type returns to the active set.
  await unarchiveEventType(page, 'Migraine');
  await syncNow(page);

  await expect
    .poll(async () => (await getRecords(userId, 'eventType'))[0]?.payload.archived, {
      timeout: 15_000,
    })
    .toBe(false);
});
