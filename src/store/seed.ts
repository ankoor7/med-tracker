// First-run seed data — a small, realistic AED-style regimen so the app is
// usable immediately. Stage 2 seeds this into IndexedDB on first run.

import type { Dataset } from '../core/types';

export function seedDataset(now: number): Dataset {
  const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';

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

  return {
    medications: [lamotrigine, levetiracetam, vitaminD],
    slots: [
      {
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
      },
      {
        id: 'seed-slot-evening',
        time: '20:00',
        label: 'Evening',
        items: [
          { medId: lamotrigine.id, dose: 150 },
          { medId: levetiracetam.id, dose: 1000 },
        ],
        updatedAt: now,
        version: 1,
      },
    ],
    doseLog: [],
    doseOverrides: [],
    eventTypes: [seizureType],
    eventInstances: [],
    settings: {
      zone: hostZone,
      adherenceWindowDays: 7,
      missedDayThreshold: 3,
      updatedAt: now,
      version: 1,
    },
  };
}
