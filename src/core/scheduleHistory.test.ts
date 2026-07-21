// Effective-dated schedule resolution — Stage 18 FR-18.1, spec §4 and AC1–AC3.
//
// The defect under test: every screen used to project every day by reapplying
// the *current* configuration, so editing a dose today rewrote yesterday and
// retiring a medication erased it from last week's adherence. These tests assert
// that a past day renders from the regimen that was actually in effect on it.

import { describe, expect, it } from 'vitest';
import { computeAdherence } from './adherence';
import { buildScheduleSnapshot, plannedSlotsAsOf, resolveScheduleAsOf } from './scheduleHistory';
import { resolveWallTimeToInstant } from './time';
import type { Medication, ScheduleSnapshot, Slot } from './types';
import { logEntry, med, scheduleSnapshot, slot } from '../test/fixtures';

const LONDON = 'Europe/London';

const at = (date: string, time: string, zone = LONDON) =>
  resolveWallTimeToInstant(date, time, zone);

const lam = med({ id: 'lam', name: 'Lamotrigine', adjustWhenLate: true });
const lev = med({ id: 'lev', name: 'Levetiracetam', adjustWhenLate: true });

/** Morning + evening slots carrying `dose` of Lamotrigine each. */
const slotsAt = (dose: number, meds: string[] = ['lam']): Slot[] => [
  slot({ id: 'morning', time: '08:00', items: meds.map((m) => ({ medId: m, dose })) }),
  slot({ id: 'evening', time: '20:00', items: meds.map((m) => ({ medId: m, dose })) }),
];

/** The scenario the spec's worked example describes: 150mg raised to 200mg. */
function doseRaisedScenario() {
  const before = scheduleSnapshot({
    id: 'snap-150',
    effectiveFrom: at('2026-07-10', '09:00'),
    medications: [lam],
    slots: slotsAt(150),
  });
  const after = scheduleSnapshot({
    id: 'snap-200',
    effectiveFrom: at('2026-07-20', '09:00'),
    medications: [lam],
    slots: slotsAt(200),
  });
  return {
    medications: [lam],
    slots: slotsAt(200), // the *current* config, post-edit
    scheduleSnapshots: [before, after],
  };
}

const doseOn = (source: Parameters<typeof resolveScheduleAsOf>[0], date: string) =>
  resolveScheduleAsOf(source, date, LONDON).slots.find((s) => s.id === 'morning')?.items[0]?.dose;

describe('resolveScheduleAsOf — AC1: a dose change does not rewrite the past', () => {
  const source = doseRaisedScenario();

  it('returns the ORIGINAL amount for a day before the change', () => {
    expect(doseOn(source, '2026-07-19')).toBe(150);
    expect(doseOn(source, '2026-07-15')).toBe(150);
  });

  it('returns the new amount for the day of the change and after', () => {
    // A change made during day D applies to D — only *earlier* days are protected.
    expect(doseOn(source, '2026-07-20')).toBe(200);
    expect(doseOn(source, '2026-07-21')).toBe(200);
  });

  it('uses the current configuration for future dates', () => {
    expect(doseOn(source, '2026-12-25')).toBe(200);
  });

  it('holds the earliest snapshot for dates before it, rather than the current config', () => {
    // Falling through to the current config here would render a 200mg dose on a
    // day that predates every recorded regimen — inventing a change.
    expect(doseOn(source, '2026-01-01')).toBe(150);
  });

  it('reports which snapshot supplied the schedule', () => {
    expect(resolveScheduleAsOf(source, '2026-07-19', LONDON).snapshotId).toBe('snap-150');
    expect(resolveScheduleAsOf(source, '2026-07-20', LONDON).snapshotId).toBe('snap-200');
  });

  it('falls back to the current config when no snapshots exist at all', () => {
    // Pre-Stage-18 datasets must behave exactly as before, not render empty.
    const noSnapshots = { medications: [lam], slots: slotsAt(200), scheduleSnapshots: [] };
    expect(doseOn(noSnapshots, '2019-01-01')).toBe(200);
    expect(resolveScheduleAsOf(noSnapshots, '2019-01-01', LONDON).snapshotId).toBeUndefined();
  });
});

/**
 * A regimen carrying `lam` only, with the slot layout changed once: `before`
 * at 2026-07-10 09:00, `after` at 2026-07-20 09:00. `current` (the live,
 * post-edit config) defaults to `after`, matching what the store would have
 * on disk; pass it explicitly when a test needs the current config to differ
 * (e.g. a slot dropped from live storage entirely rather than tombstoned).
 * Shared by the slot time/membership/removal tests below — they differ only
 * in which slots they pass in, not in the scenario shape.
 */
function slotChangeScenario(before: Slot[], after: Slot[], current: Slot[] = after) {
  return {
    medications: [lam],
    slots: current,
    scheduleSnapshots: [
      scheduleSnapshot({
        effectiveFrom: at('2026-07-10', '09:00'),
        medications: [lam],
        slots: before,
      }),
      scheduleSnapshot({
        effectiveFrom: at('2026-07-20', '09:00'),
        medications: [lam],
        slots: after,
      }),
    ],
  };
}

describe('resolveScheduleAsOf — slot time, membership and removal', () => {
  it('keeps a past day on the old slot time when the slot is later moved', () => {
    const source = slotChangeScenario(
      [slot({ id: 'evening', time: '20:00', items: [{ medId: 'lam', dose: 150 }] })],
      [slot({ id: 'evening', time: '21:00', items: [{ medId: 'lam', dose: 150 }] })],
    );
    expect(resolveScheduleAsOf(source, '2026-07-19', LONDON).slots[0]?.time).toBe('20:00');
    expect(resolveScheduleAsOf(source, '2026-07-20', LONDON).slots[0]?.time).toBe('21:00');
  });

  it('does not show a newly added slot on earlier days', () => {
    const morning = slot({ id: 'morning', time: '08:00', items: [{ medId: 'lam', dose: 150 }] });
    const midday = slot({ id: 'midday', time: '13:00', items: [{ medId: 'lam', dose: 150 }] });
    const source = slotChangeScenario([morning], [morning, midday]);
    const ids = (date: string) => resolveScheduleAsOf(source, date, LONDON).slots.map((s) => s.id);
    expect(ids('2026-07-19')).toEqual(['morning']);
    expect(ids('2026-07-20')).toEqual(['morning', 'midday']);
  });

  it('restores a slot that was later removed (the reversed slot-removal case)', () => {
    const morning = slot({ id: 'morning', time: '08:00', items: [{ medId: 'lam', dose: 150 }] });
    const evening = slot({ id: 'evening', time: '20:00', items: [{ medId: 'lam', dose: 150 }] });
    // The evening slot was tombstoned by `deleteSlot`; live storage keeps only
    // the morning one.
    const source = slotChangeScenario(
      [morning, evening],
      [morning, { ...evening, deleted: true }],
      [morning],
    );
    // The prior day still enumerates both slots...
    expect(
      plannedSlotsAsOf(source, '2026-07-19', [], LONDON, at('2026-07-25', '12:00')).map(
        (s) => s.slotId,
      ),
    ).toEqual(['morning', 'evening']);
    // ...while the day of the removal onwards has only the morning one, because
    // `plannedSlotsForDate` skips tombstoned slots.
    expect(
      plannedSlotsAsOf(source, '2026-07-20', [], LONDON, at('2026-07-25', '12:00')).map(
        (s) => s.slotId,
      ),
    ).toEqual(['morning']);
  });
});

describe('resolveScheduleAsOf — multiple changes and same-day edits', () => {
  it('takes the LAST snapshot of a day when several changes were made on it', () => {
    const source = {
      medications: [lam],
      slots: slotsAt(300),
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-07-19', '23:00'),
          medications: [lam],
          slots: slotsAt(100),
        }),
        scheduleSnapshot({
          effectiveFrom: at('2026-07-20', '09:00'),
          medications: [lam],
          slots: slotsAt(200),
        }),
        scheduleSnapshot({
          effectiveFrom: at('2026-07-20', '17:00'),
          medications: [lam],
          slots: slotsAt(300),
        }),
      ],
    };
    expect(doseOn(source, '2026-07-19')).toBe(100); // untouched by either edit
    expect(doseOn(source, '2026-07-20')).toBe(300); // the day settles on its final state
  });

  it('is independent of array order (sync merges do not preserve it)', () => {
    const source = doseRaisedScenario();
    const shuffled = {
      ...source,
      scheduleSnapshots: [...source.scheduleSnapshots].reverse(),
    };
    expect(doseOn(shuffled, '2026-07-19')).toBe(150);
    expect(doseOn(shuffled, '2026-07-20')).toBe(200);
  });

  it('ignores tombstoned snapshots', () => {
    const source = doseRaisedScenario();
    const withDeleted = {
      ...source,
      scheduleSnapshots: [
        ...source.scheduleSnapshots,
        scheduleSnapshot({
          effectiveFrom: at('2026-07-12', '09:00'),
          medications: [lam],
          slots: slotsAt(999),
          deleted: true,
        }),
      ],
    };
    expect(doseOn(withDeleted, '2026-07-19')).toBe(150);
  });

  it('keeps a dose logged the same day as a change matched to that day', () => {
    // A change at 17:00 and a dose logged at 08:00 the same morning: the day
    // resolves to the post-change regimen, and the morning dose still matches
    // its occurrence rather than being orphaned.
    const source = {
      medications: [lam],
      slots: slotsAt(200),
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-07-10', '09:00'),
          medications: [lam],
          slots: slotsAt(150),
        }),
        scheduleSnapshot({
          effectiveFrom: at('2026-07-20', '17:00'),
          medications: [lam],
          slots: slotsAt(200),
        }),
      ],
    };
    const scheduled = at('2026-07-20', '08:00');
    const log = [
      logEntry({
        slotId: 'morning',
        medId: 'lam',
        scheduledInstant: scheduled,
        actualInstant: scheduled,
        dose: 150,
        zone: LONDON,
      }),
    ];
    const planned = plannedSlotsAsOf(source, '2026-07-20', log, LONDON, at('2026-07-25', '12:00'));
    const morning = planned.find((s) => s.slotId === 'morning')?.occurrences[0];
    expect(morning?.status).toBe('taken');
    // The *planned* amount follows the resolved regimen; the amount actually
    // taken is the log entry's own, which the app never rewrites.
    expect(morning?.dose).toBe(200);
    expect(log[0]!.dose).toBe(150);
  });
});

describe('resolveScheduleAsOf — DST and zone boundaries', () => {
  // 2026 UK clocks go forward 2026-03-29 and back 2026-10-25.
  it('a change made late on the day clocks go forward still applies to that day', () => {
    const source = {
      medications: [lam],
      slots: slotsAt(200),
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-03-01', '09:00'),
          medications: [lam],
          slots: slotsAt(150),
        }),
        // 23:30 BST on the short (23-hour) day.
        scheduleSnapshot({
          effectiveFrom: at('2026-03-29', '23:30'),
          medications: [lam],
          slots: slotsAt(200),
        }),
      ],
    };
    expect(doseOn(source, '2026-03-28')).toBe(150);
    expect(doseOn(source, '2026-03-29')).toBe(200);
    expect(doseOn(source, '2026-03-30')).toBe(200);
  });

  it('a change made late on the day clocks go back still applies to that day', () => {
    const source = {
      medications: [lam],
      slots: slotsAt(200),
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-10-01', '09:00'),
          medications: [lam],
          slots: slotsAt(150),
        }),
        // 23:30 GMT on the long (25-hour) day — an instant a naive
        // "midnight + 24h" day boundary would place on the following day.
        scheduleSnapshot({
          effectiveFrom: at('2026-10-25', '23:30'),
          medications: [lam],
          slots: slotsAt(200),
        }),
      ],
    };
    expect(doseOn(source, '2026-10-24')).toBe(150);
    expect(doseOn(source, '2026-10-25')).toBe(200);
    expect(doseOn(source, '2026-10-26')).toBe(200);
  });

  it('places the day boundary in the query zone, not the host or snapshot zone', () => {
    // 2026-07-20 06:00 in Tokyo (UTC+9) is 2026-07-19 22:00 in London (BST,
    // UTC+1). The same snapshot instant therefore lands on different local days
    // depending on which zone is being asked about.
    const source = {
      medications: [lam],
      slots: slotsAt(200),
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-07-01', '09:00'),
          medications: [lam],
          slots: slotsAt(150),
        }),
        scheduleSnapshot({
          effectiveFrom: at('2026-07-20', '06:00', 'Asia/Tokyo'),
          zone: 'Asia/Tokyo',
          medications: [lam],
          slots: slotsAt(200),
        }),
      ],
    };
    const doseIn = (zone: string, date: string) =>
      resolveScheduleAsOf(source, date, zone).slots.find((s) => s.id === 'morning')?.items[0]?.dose;
    // In Tokyo the change belongs to the 20th, so the 19th keeps 150mg.
    expect(doseIn('Asia/Tokyo', '2026-07-19')).toBe(150);
    expect(doseIn('Asia/Tokyo', '2026-07-20')).toBe(200);
    // In London the same instant fell on the 19th, so the 19th already has 200mg.
    expect(doseIn(LONDON, '2026-07-19')).toBe(200);
    expect(doseIn(LONDON, '2026-07-18')).toBe(150);
  });
});

describe('resolveScheduleAsOf — AC3: medication start dates', () => {
  const started = med({ id: 'new', name: 'New Med', startedAt: at('2026-07-15', '10:00') });
  const source = {
    medications: [lam, started],
    slots: [
      slot({
        id: 'morning',
        time: '08:00',
        items: [
          { medId: 'lam', dose: 150 },
          { medId: 'new', dose: 50 },
        ],
      }),
    ],
    scheduleSnapshots: [] as ScheduleSnapshot[],
  };

  it('excludes a medication from days entirely before its start date', () => {
    const resolved = resolveScheduleAsOf(source, '2026-07-14', LONDON);
    expect(resolved.medications.map((m) => m.id)).toEqual(['lam']);
    expect(resolved.slots[0]?.items.map((i) => i.medId)).toEqual(['lam']);
  });

  it('includes it from its start day onwards', () => {
    for (const date of ['2026-07-15', '2026-07-16']) {
      const resolved = resolveScheduleAsOf(source, date, LONDON);
      expect(resolved.medications.map((m) => m.id)).toEqual(['lam', 'new']);
    }
  });

  it('treats a medication with no startedAt as having always existed', () => {
    // Nothing may regress before the upgrade prompt populates the field.
    const resolved = resolveScheduleAsOf(source, '1999-01-01', LONDON);
    expect(resolved.medications.map((m) => m.id)).toEqual(['lam']);
  });

  it('drops a slot left with no items once its only medication is excluded', () => {
    const soloSource = {
      medications: [started],
      slots: [slot({ id: 'morning', time: '08:00', items: [{ medId: 'new', dose: 50 }] })],
      scheduleSnapshots: [] as ScheduleSnapshot[],
    };
    expect(resolveScheduleAsOf(soloSource, '2026-07-14', LONDON).slots).toEqual([]);
    expect(resolveScheduleAsOf(soloSource, '2026-07-15', LONDON).slots).toHaveLength(1);
  });

  it('applies startedAt retroactively over a snapshot that predates the field', () => {
    // The upgrade prompt sets `startedAt` on the *current* medication; snapshots
    // captured earlier still carry the old copy without it. The current value
    // must win, or answering the prompt would have no effect on history.
    const withSnapshot = {
      medications: [{ ...started }],
      slots: soloSlots(),
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-07-01', '09:00'),
          medications: [med({ id: 'new', name: 'New Med' })], // no startedAt
          slots: soloSlots(),
        }),
      ],
    };
    expect(resolveScheduleAsOf(withSnapshot, '2026-07-14', LONDON).medications).toEqual([]);
    expect(resolveScheduleAsOf(withSnapshot, '2026-07-16', LONDON).medications).toHaveLength(1);
  });
});

function soloSlots(): Slot[] {
  return [slot({ id: 'morning', time: '08:00', items: [{ medId: 'new', dose: 50 }] })];
}

describe('computeAdherence — AC1: prior-date figures survive a regimen edit', () => {
  const now = at('2026-07-20', '23:00');
  const log = (dates: string[], dose: number) =>
    dates.flatMap((d) =>
      ['08:00', '20:00'].map((time) =>
        logEntry({
          slotId: time === '08:00' ? 'morning' : 'evening',
          medId: 'lam',
          scheduledInstant: at(d, time),
          actualInstant: at(d, time),
          dose,
          zone: LONDON,
        }),
      ),
    );
  const days = ['2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20'];

  it('is identical before and after a dose change', () => {
    const beforeEdit = {
      medications: [lam],
      slots: slotsAt(150),
      scheduleSnapshots: [
        scheduleSnapshot({
          id: 's1',
          effectiveFrom: at('2026-07-01', '09:00'),
          medications: [lam],
          slots: slotsAt(150),
        }),
      ],
    };
    const afterEdit = {
      medications: [lam],
      slots: slotsAt(200),
      scheduleSnapshots: [
        ...beforeEdit.scheduleSnapshots,
        scheduleSnapshot({
          id: 's2',
          effectiveFrom: at('2026-07-20', '21:00'),
          medications: [lam],
          slots: slotsAt(200),
        }),
      ],
    };
    const entries = log(days, 150);
    const run = (src: typeof beforeEdit) =>
      computeAdherence(
        src.slots,
        src.medications,
        entries,
        LONDON,
        4,
        2,
        now,
        false,
        src.scheduleSnapshots,
      );

    expect(run(afterEdit)).toEqual(run(beforeEdit));
    expect(run(beforeEdit).expected).toBe(8); // 4 days × 2 slots
    expect(run(beforeEdit).taken).toBe(8);
  });
});

describe('computeAdherence — AC2: retiring a medication does not erase its past', () => {
  const now = at('2026-07-20', '23:00');
  const days = ['2026-07-18', '2026-07-19'];

  /** Both meds scheduled, then Levetiracetam retired on the 20th. */
  function retiredScenario(retire: (m: Medication) => Medication) {
    const bothSlots = slotsAt(150, ['lam', 'lev']);
    return {
      medications: [lam, retire(lev)],
      slots: bothSlots,
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-07-01', '09:00'),
          medications: [lam, lev],
          slots: bothSlots,
        }),
        scheduleSnapshot({
          effectiveFrom: at('2026-07-20', '21:00'),
          medications: [lam, retire(lev)],
          slots: bothSlots,
        }),
      ],
    };
  }

  const entries = days.flatMap((d) =>
    ['08:00', '20:00'].flatMap((time) =>
      ['lam', 'lev'].map((medId) =>
        logEntry({
          slotId: time === '08:00' ? 'morning' : 'evening',
          medId,
          scheduledInstant: at(d, time),
          actualInstant: at(d, time),
          dose: 150,
          zone: LONDON,
        }),
      ),
    ),
  );

  const expectedFor = (src: ReturnType<typeof retiredScenario>) =>
    computeAdherence(
      src.slots,
      src.medications,
      entries,
      LONDON,
      3,
      2,
      now,
      false,
      src.scheduleSnapshots,
    ).expected;

  it('keeps expected doses for the days it was active (soft "stop taking")', () => {
    // Two days × two slots × two meds = 8, plus nothing yet due on the 20th
    // (now is 23:00 so both of the 20th's slots are past) → the 20th
    // contributes only Lamotrigine's two, since Levetiracetam retired that day.
    const src = retiredScenario((m) => ({ ...m, active: false }));
    expect(expectedFor(src)).toBe(10);
  });

  it('keeps expected doses after a hard delete (tombstone + slot cascade)', () => {
    // `deleteMedication` both tombstones the medication and strips it from every
    // slot; the prior snapshot is what preserves the history.
    const bothSlots = slotsAt(150, ['lam', 'lev']);
    const src = {
      medications: [lam, { ...lev, deleted: true }],
      slots: slotsAt(150, ['lam']), // cascade already applied
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-07-01', '09:00'),
          medications: [lam, lev],
          slots: bothSlots,
        }),
        scheduleSnapshot({
          effectiveFrom: at('2026-07-20', '21:00'),
          medications: [lam, { ...lev, deleted: true }],
          slots: slotsAt(150, ['lam']),
        }),
      ],
    };
    expect(expectedFor(src)).toBe(10);
  });

  it('WOULD have dropped to Lamotrigine-only without snapshots (the old bug)', () => {
    // Pins the regression: with no snapshot history the retired medication's
    // past expected doses vanish — 6 instead of 10.
    const src = retiredScenario((m) => ({ ...m, active: false }));
    const noHistory = computeAdherence(
      src.slots,
      src.medications,
      entries,
      LONDON,
      3,
      2,
      now,
      false,
      [],
    );
    expect(noHistory.expected).toBe(6);
  });

  it('re-includes a medication that was retired and later reactivated', () => {
    // add → retire → reactivate: each transition is its own snapshot, so each
    // stretch of days resolves to the state that actually applied to it.
    const bothSlots = slotsAt(150, ['lam', 'lev']);
    const src = {
      medications: [lam, lev],
      slots: bothSlots,
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-07-01', '09:00'),
          medications: [lam, lev],
          slots: bothSlots,
        }),
        scheduleSnapshot({
          effectiveFrom: at('2026-07-18', '12:00'),
          medications: [lam, { ...lev, active: false }],
          slots: bothSlots,
        }),
        scheduleSnapshot({
          effectiveFrom: at('2026-07-20', '12:00'),
          medications: [lam, lev],
          slots: bothSlots,
        }),
      ],
    };
    const ids = (date: string) =>
      resolveScheduleAsOf(src, date, LONDON)
        .medications.filter((m) => m.active)
        .map((m) => m.id);
    expect(ids('2026-07-17')).toEqual(['lam', 'lev']); // originally active
    expect(ids('2026-07-18')).toEqual(['lam']); // retired that day
    expect(ids('2026-07-19')).toEqual(['lam']); // still retired
    expect(ids('2026-07-20')).toEqual(['lam', 'lev']); // reactivated
  });
});

describe('computeAdherence — AC3: a window wider than a start date', () => {
  const now = at('2026-07-20', '23:00');
  const startedOn18 = med({
    id: 'lam',
    name: 'Lamotrigine',
    adjustWhenLate: true,
    startedAt: at('2026-07-18', '09:00'),
  });

  it('excludes days before the start date from the expected count', () => {
    const src = {
      medications: [startedOn18],
      slots: slotsAt(150),
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-07-18', '09:00'),
          medications: [startedOn18],
          slots: slotsAt(150),
        }),
      ],
    };
    // A 7-day window reaches back to 2026-07-14, but only the 18th–20th count:
    // 3 days × 2 slots.
    const result = computeAdherence(
      src.slots,
      src.medications,
      [],
      LONDON,
      7,
      2,
      now,
      true, // assume-taken-on-time, which is what fabricated the 100% figure
      src.scheduleSnapshots,
    );
    expect(result.expected).toBe(6);
    expect(result.taken).toBe(6);
  });

  it('fabricates the full window when the start date is absent (documented default)', () => {
    const noStart = { ...startedOn18, startedAt: undefined };
    const src = {
      medications: [noStart],
      slots: slotsAt(150),
      scheduleSnapshots: [
        scheduleSnapshot({
          effectiveFrom: at('2026-07-18', '09:00'),
          medications: [noStart],
          slots: slotsAt(150),
        }),
      ],
    };
    // 7 days × 2 slots — the pre-Stage-18 behaviour, retained until the upgrade
    // prompt (piece 3) supplies a real start date.
    expect(
      computeAdherence(
        src.slots,
        src.medications,
        [],
        LONDON,
        7,
        2,
        now,
        true,
        src.scheduleSnapshots,
      ).expected,
    ).toBe(14);
  });
});

describe('buildScheduleSnapshot', () => {
  it('deep-copies so later mutation of the live records cannot alter history', () => {
    const liveMed = med({ id: 'lam' });
    const liveSlot = slot({ id: 'morning', time: '08:00', items: [{ medId: 'lam', dose: 150 }] });
    const snap = buildScheduleSnapshot('snap-1', [liveMed], [liveSlot], 1000, LONDON);

    liveMed.name = 'Renamed';
    liveSlot.items[0]!.dose = 999;
    liveSlot.time = '09:00';

    expect(snap.medications[0]!.name).not.toBe('Renamed');
    expect(snap.slots[0]!.items[0]!.dose).toBe(150);
    expect(snap.slots[0]!.time).toBe('08:00');
  });

  it('stamps effectiveFrom and updatedAt equally at creation', () => {
    const snap = buildScheduleSnapshot('snap-1', [], [], 1234, LONDON);
    expect(snap.effectiveFrom).toBe(1234);
    expect(snap.updatedAt).toBe(1234);
    expect(snap.zone).toBe(LONDON);
  });
});
