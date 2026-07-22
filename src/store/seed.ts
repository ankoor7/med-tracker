// First-run seed data — a small, realistic AED-style regimen so the app is
// usable immediately. Stage 2 seeds this into IndexedDB on first run.

import { DEFAULT_ON_TIME_WINDOW_MINUTES } from '../core/adherence';
import { startOfDayInstant } from '../core/startDate';
import { isoDateInZone } from '../core/time';
import type { Dataset, Slot } from '../core/types';

export function seedDataset(now: number): Dataset {
  const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  // Every seeded medication gets a `startedAt` (Stage 18 FR-18.1 piece 3) so a
  // fresh install never sees the upgrade-time start-date prompt — only a
  // dataset that predates the field does. Well before the 30-day snapshot
  // history so it never excludes any of the seeded days.
  const seedStartedAt = startOfDayInstant(
    isoDateInZone(now - 200 * 24 * 60 * 60 * 1000, hostZone),
    hostZone,
  );

  const lamotrigine = {
    id: 'seed-med-lamotrigine',
    name: 'Lamotrigine',
    color: '#0f766e',
    unit: 'mg',
    halfLifeHours: 29,
    adjustWhenLate: true,
    active: true,
    notes: 'Timing-sensitive — take an adjusted dose if late.',
    guardrails: { maxSingleDose: 200, maxDailyDose: 400, minIntervalHours: 6 },
    startedAt: seedStartedAt,
    updatedAt: now,
    version: 1,
  };

  const levetiracetam = {
    id: 'seed-med-levetiracetam',
    name: 'Levetiracetam',
    color: '#2563eb',
    unit: 'mg',
    halfLifeHours: 7,
    adjustWhenLate: true,
    active: true,
    guardrails: { maxSingleDose: 1000, maxDailyDose: 3000, minIntervalHours: 8 },
    startedAt: seedStartedAt,
    updatedAt: now,
    version: 1,
  };

  const vitaminD = {
    id: 'seed-med-vitamind',
    name: 'Vitamin D',
    color: '#ca8a04',
    unit: 'IU',
    halfLifeHours: 480,
    adjustWhenLate: false,
    active: true,
    notes: 'Flexible — timing not critical.',
    guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
    startedAt: seedStartedAt,
    updatedAt: now,
    version: 1,
  };

  // One example health-condition event type so the feature is discoverable on
  // first run (Stage 13). Its properties are ordinary, editable/removable defs.
  const seizureType = {
    id: 'seed-event-seizure',
    name: 'Seizure',
    color: '#9333ea',
    properties: [
      { id: 'severity', name: 'Severity', type: 'scale' as const, min: 1, max: 5 },
      { id: 'duration', name: 'Duration', type: 'duration' as const },
      { id: 'notes', name: 'What happened', type: 'text' as const },
    ],
    notes: 'Log a seizure with its severity and how long it lasted.',
    updatedAt: now,
    version: 1,
  };

  const morningSlot: Slot = {
    id: 'seed-slot-morning',
    time: '08:00',
    label: 'Morning',
    items: [
      { medId: lamotrigine.id, dose: 150 },
      { medId: levetiracetam.id, dose: 1000 },
      { medId: vitaminD.id, dose: 1000 },
    ],
    updatedAt: now,
    version: 1,
  };

  const eveningSlot: Slot = {
    id: 'seed-slot-evening',
    time: '20:00',
    label: 'Evening',
    items: [
      { medId: lamotrigine.id, dose: 150 },
      { medId: levetiracetam.id, dose: 1000 },
    ],
    updatedAt: now,
    version: 1,
  };

  // The morning Lamotrigine dose was raised 100mg → 150mg five days ago. The
  // slot above holds the *current* (150mg) regimen; this is what it looked like
  // before that change, and it is what days six-or-more days back must render.
  const morningSlotBefore: Slot = {
    ...morningSlot,
    items: morningSlot.items.map((i) =>
      i.medId === lamotrigine.id ? { ...i, dose: 100 } : { ...i },
    ),
    updatedAt: thirtyDaysAgo,
  };

  return {
    medications: [lamotrigine, levetiracetam, vitaminD],
    slots: [morningSlot, eveningSlot],
    doseLog: [],
    doseOverrides: [],
    eventTypes: [seizureType],
    eventInstances: [],
    // One example regimen change a few days back so the timeline markers are
    // visible in the demo dataset (Stage 16): the morning Lamotrigine dose was
    // raised 100mg → 150mg.
    regimenChanges: [
      {
        id: 'seed-change-lamotrigine-dose',
        changedAt: fiveDaysAgo,
        zone: hostZone,
        kind: 'slot-updated' as const,
        slotId: 'seed-slot-morning',
        summary: 'Morning: Lamotrigine dose 100mg → 150mg',
        changes: [{ field: 'Lamotrigine dose', from: '100mg', to: '150mg' }],
        updatedAt: fiveDaysAgo,
        version: 1,
      },
    ],
    // The effective-dated history behind that change (Stage 18 FR-18.1), so a
    // fresh install demonstrates correct historical rendering: days on or after
    // the change show 150mg, earlier days still show the 100mg they were taken
    // at. The two snapshots are the regimen before and after the same edit the
    // marker above describes.
    scheduleSnapshots: [
      {
        id: 'seed-snapshot-initial',
        effectiveFrom: thirtyDaysAgo,
        zone: hostZone,
        medications: [lamotrigine, levetiracetam, vitaminD],
        slots: [morningSlotBefore, eveningSlot],
        updatedAt: thirtyDaysAgo,
        version: 1,
      },
      {
        id: 'seed-snapshot-lamotrigine-150',
        effectiveFrom: fiveDaysAgo,
        zone: hostZone,
        medications: [lamotrigine, levetiracetam, vitaminD],
        slots: [morningSlot, eveningSlot],
        updatedAt: fiveDaysAgo,
        version: 1,
      },
    ],
    settings: {
      zone: hostZone,
      adherenceWindowDays: 7,
      missedDayThreshold: 3,
      assumeTakenOnTime: true,
      onTimeWindowMinutes: DEFAULT_ON_TIME_WINDOW_MINUTES,
      updatedAt: now,
      version: 1,
    },
  };
}
