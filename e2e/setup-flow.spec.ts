// Stage 10 flagship E2E: first-run setup.
//
// A new user signs in, creates three medications, and groups them into mixed
// time-slots across the day — all through the real UI. We then assert the rows
// landed in the Supabase `records` table with correct typed payloads, proving the
// full UI -> store -> sync -> push_records RPC -> Postgres round-trip.

import { test, expect } from '@playwright/test';
import {
  addMedication,
  addSlot,
  signIn,
  syncNow,
  type MedSpec,
  type SlotSpec,
} from './helpers/app';
import { clearUserRecords, getRecords, getUserId, closePool } from './helpers/db';

const MEDS: MedSpec[] = [
  { name: 'Levothyroxine', unit: 'mcg', halfLifeHours: 168 },
  { name: 'Metformin', unit: 'mg', halfLifeHours: 6 },
  { name: 'Atorvastatin', unit: 'mg', halfLifeHours: 14 },
];

// Mixed groups across the day: a morning group and an evening group, with
// Metformin deliberately appearing in both slots.
const SLOTS: SlotSpec[] = [
  {
    time: '07:00',
    label: 'Morning',
    items: [
      { med: 'Levothyroxine', dose: 100 },
      { med: 'Metformin', dose: 500 },
    ],
  },
  {
    time: '20:00',
    label: 'Evening',
    items: [
      { med: 'Metformin', dose: 500 },
      { med: 'Atorvastatin', dose: 20 },
    ],
  },
];

let userId: string;

test.beforeAll(async () => {
  userId = await getUserId();
});

test.beforeEach(async () => {
  // Deterministic re-runs: the dev account is shared, so wipe its rows first.
  await clearUserRecords(userId);
});

test.afterAll(async () => {
  await closePool();
});

test('first-run setup creates 3 meds in mixed daily groups and persists to the DB', async ({
  page,
}) => {
  await page.goto('/');

  // 1. Sign in with the seeded dev account.
  await signIn(page);

  // 2. Create three medications through the UI.
  for (const med of MEDS) {
    await addMedication(page, med);
  }

  // 3. Group them into mixed time-slots across the day.
  for (const slot of SLOTS) {
    await addSlot(page, slot);
  }

  // 4. Push to the cloud and wait for it to settle.
  await syncNow(page);

  // 5. Assert the medications landed in the DB (poll to absorb any sync timing).
  await expect
    .poll(async () => (await getRecords(userId, 'medication')).length, { timeout: 15_000 })
    .toBe(3);

  const medRows = await getRecords(userId, 'medication');
  const byName = new Map(medRows.map((r) => [String(r.payload.name), r]));
  expect([...byName.keys()].sort()).toEqual([...MEDS].map((m) => m.name).sort());
  for (const med of MEDS) {
    const row = byName.get(med.name)!;
    expect(row.deleted).toBe(false);
    expect(row.payload.unit).toBe(med.unit);
    expect(row.payload.halfLifeHours).toBe(med.halfLifeHours);
    expect(row.payload.active).toBe(true);
  }

  // 6. Assert the two mixed slot groups, with items referencing the right meds.
  const slotRows = await getRecords(userId, 'slot');
  expect(slotRows.length).toBe(2);

  const slotsByTime = new Map(slotRows.map((r) => [String(r.payload.time), r]));
  expect([...slotsByTime.keys()].sort()).toEqual(['07:00', '20:00']);

  const medIdByName = new Map([...byName].map(([name, row]) => [name, row.id]));
  for (const expected of SLOTS) {
    const row = slotsByTime.get(expected.time)!;
    expect(row.payload.label).toBe(expected.label);
    const items = row.payload.items as Array<{ medId: string; dose: number }>;
    const actual = items
      .map((it) => ({ medId: it.medId, dose: it.dose }))
      .sort((a, b) => a.medId.localeCompare(b.medId));
    const want = expected.items
      .map((it) => ({ medId: medIdByName.get(it.med)!, dose: it.dose }))
      .sort((a, b) => a.medId.localeCompare(b.medId));
    expect(actual).toEqual(want);
  }

  // Metformin is the mixed-group medication: present in both slots.
  const metforminId = medIdByName.get('Metformin')!;
  const slotsWithMetformin = slotRows.filter((r) =>
    (r.payload.items as Array<{ medId: string }>).some((it) => it.medId === metforminId),
  );
  expect(slotsWithMetformin.length).toBe(2);
});
