// Stage 12 E2E: the late-dose → adjust-next-dose workflow.
//
// A user logs a scheduled dose at an adjusted amount and, in the same flow, sets a
// one-time override for the next scheduled dose. We then assert both the `doseLog`
// row and the new `doseOverride` row landed in Supabase with the right payloads —
// proving the override travels the full UI -> store -> sync -> push_records RPC ->
// Postgres round-trip just like every other record.

import { test, expect } from '@playwright/test';
import { addMedication, addSlot, logDose, signIn, syncNow } from './helpers/app';
import { clearUserRecords, getRecords, getUserId, closePool } from './helpers/db';

const MED = { name: 'Lamotrigine', unit: 'mg', halfLifeHours: 29 };
const SCHEDULED_DOSE = 150;
const ADJUSTED_DOSE = 60; // taken now, late
const NEXT_DOSE = 100; // one-time override for the next occurrence

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

test('logging an adjusted dose can set a synced one-time next-dose override', async ({ page }) => {
  await page.goto('/');
  await signIn(page);

  // One med scheduled twice a day, so there is always a "next" occurrence.
  await addMedication(page, MED);
  await addSlot(page, {
    time: '08:00',
    label: 'Morning',
    items: [{ med: MED.name, dose: SCHEDULED_DOSE }],
  });
  await addSlot(page, {
    time: '20:00',
    label: 'Evening',
    items: [{ med: MED.name, dose: SCHEDULED_DOSE }],
  });

  // Log the first (08:00) occurrence at an adjusted amount and, in the same flow,
  // set a one-time override for the next dose.
  await logDose(page, { med: MED.name, dose: ADJUSTED_DOSE, nextDose: NEXT_DOSE });

  await syncNow(page);

  // The logged dose persisted, flagged adjusted.
  await expect
    .poll(async () => (await getRecords(userId, 'doseLog')).length, { timeout: 15_000 })
    .toBe(1);
  const [logRow] = await getRecords(userId, 'doseLog');
  expect(logRow!.payload.dose).toBe(ADJUSTED_DOSE);
  expect(logRow!.payload.adjusted).toBe(true);

  // The one-time override persisted for the next occurrence of the same med.
  await expect
    .poll(async () => (await getRecords(userId, 'doseOverride')).filter((r) => !r.deleted).length, {
      timeout: 15_000,
    })
    .toBe(1);

  // The logged occurrence is the earliest slot (08:00); the next occurrence of the
  // same med is the 20:00 slot, so the override deterministically targets it.
  const slotRows = await getRecords(userId, 'slot');
  const eveningSlot = slotRows.find((r) => String(r.payload.time) === '20:00')!;
  const loggedSlotId = String(logRow!.payload.slotId);

  const [ovr] = (await getRecords(userId, 'doseOverride')).filter((r) => !r.deleted);
  expect(ovr!.payload.dose).toBe(NEXT_DOSE);
  expect(ovr!.payload.medId).toBe(logRow!.payload.medId);
  expect(ovr!.payload.slotId).toBe(eveningSlot.id);
  expect(ovr!.payload.slotId).not.toBe(loggedSlotId);
  expect(Number(ovr!.payload.scheduledInstant)).toBeGreaterThan(
    Number(logRow!.payload.scheduledInstant),
  );
});
