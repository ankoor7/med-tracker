import { describe, expect, it } from 'vitest';
import { computeAdherence, DEFAULT_ON_TIME_WINDOW_MINUTES } from './adherence';
import { resolveWallTimeToInstant } from './time';
import { logEntry, med, slot } from '../test/fixtures';
import type { Instant } from './types';

const ZONE = 'Europe/London';
const at = (date: string, time: string) => resolveWallTimeToInstant(date, time, ZONE);

/** Assert a result is fully on time: no late, no shortfall on the ratio. */
function expectFullyOnTime(r: { onTime: number; late: number; ratio: number }) {
  expect(r.onTime).toBe(1);
  expect(r.late).toBe(0);
  expect(r.ratio).toBe(1);
}

// "Now" is set late on 2026-06-15 so the whole 3-day window is past-due.
const NOW = at('2026-06-15', '23:00');

describe('computeAdherence (timing-sensitive only)', () => {
  const sensitive = med({ id: 'sens', adjustWhenLate: true });
  const flexible = med({ id: 'flex', adjustWhenLate: false });
  const s = slot({
    id: 's1',
    time: '08:00',
    items: [
      { medId: 'sens', dose: 1 },
      { medId: 'flex', dose: 1 },
    ],
  });

  it('counts only timing-sensitive occurrences', () => {
    // 3-day window, one slot/day → 3 expected sensitive occurrences, all missed.
    const r = computeAdherence([s], [sensitive, flexible], [], ZONE, 3, 2, NOW);
    expect(r.expected).toBe(3); // flexible not counted
    expect(r.missed).toBe(3);
    expect(r.taken).toBe(0);
    expect(r.ratio).toBe(0);
  });

  it('scores taken vs missed across the window', () => {
    const taken = [
      logEntry({ medId: 'sens', slotId: 's1', scheduledInstant: at('2026-06-13', '08:00') }),
      logEntry({ medId: 'sens', slotId: 's1', scheduledInstant: at('2026-06-14', '08:00') }),
    ];
    const r = computeAdherence([s], [sensitive, flexible], taken, ZONE, 3, 2, NOW);
    expect(r.expected).toBe(3);
    expect(r.taken).toBe(2);
    expect(r.missed).toBe(1);
    expect(r.ratio).toBeCloseTo(2 / 3);
  });

  it('raises a missed-pattern warning when missed exceeds threshold', () => {
    const r = computeAdherence([s], [sensitive], [], ZONE, 3, 2, NOW);
    expect(r.missed).toBe(3);
    expect(r.missedPatternWarning).toBe(true); // 3 > 2
  });

  it('does not warn at or below threshold', () => {
    const taken = [
      logEntry({ medId: 'sens', slotId: 's1', scheduledInstant: at('2026-06-13', '08:00') }),
    ];
    const r = computeAdherence([s], [sensitive], taken, ZONE, 3, 2, NOW);
    expect(r.missed).toBe(2);
    expect(r.missedPatternWarning).toBe(false); // 2 > 2 is false
  });

  it('does not score future (upcoming) occurrences', () => {
    // Now is early on the last day, so today's 08:00 is still upcoming.
    const earlyNow = at('2026-06-15', '06:00');
    const r = computeAdherence([s], [sensitive], [], ZONE, 1, 0, earlyNow);
    expect(r.expected).toBe(0);
    expect(r.ratio).toBe(1); // nothing expected → treated as fully adherent
  });

  // FR-18.1 piece 3, AC3 end-to-end: widening the window must not fabricate
  // 100% adherence for days before a medication was actually prescribed.
  // `resolveScheduleAsOf` (piece 1) already excludes it at the core level;
  // this proves the exclusion actually reaches the adherence computation the
  // History screen renders.
  it('excludes days before a medication started from its expected-dose count (AC3)', () => {
    // Started on the middle day of a 5-day window; nothing was logged.
    const started = med({ id: 'sens', adjustWhenLate: true, startedAt: at('2026-06-13', '00:00') });
    const r = computeAdherence([s], [started, flexible], [], ZONE, 5, 2, NOW);
    // Window is 06-11..06-15. Only 06-13, 06-14, 06-15 count for this med.
    expect(r.expected).toBe(3);
    expect(r.missed).toBe(3);

    // Without a start date, the same window counts every day.
    const alwaysExisted = med({ id: 'sens', adjustWhenLate: true });
    const rWide = computeAdherence([s], [alwaysExisted, flexible], [], ZONE, 5, 2, NOW);
    expect(rWide.expected).toBe(5);
  });
});

// Stage 18 FR-18.4 — lateness-aware adherence. The exact Journey 3 regression:
// doses logged 15h30m and 3h30m late must no longer read as 100% (they were
// "taken" under the old model, which never looked at delay).
describe('computeAdherence — FR-18.4: lateness-aware adherence', () => {
  const sensitive = med({ id: 'sens', adjustWhenLate: true });
  const s = slot({ id: 's1', time: '08:00', items: [{ medId: 'sens', dose: 100 }] });

  it('AC4: a dose logged outside the on-time window reports as late, not on-time, distinct from missed', () => {
    const scheduled = at('2026-06-15', '08:00');
    const late = logEntry({
      medId: 'sens',
      slotId: 's1',
      scheduledInstant: scheduled,
      actualInstant: scheduled + 90 * 60_000, // 90m late, default window is 60m
    });
    const r = computeAdherence([s], [sensitive], [late], ZONE, 1, 2, NOW, false, [], 60);
    expect(r.onTime).toBe(0);
    expect(r.late).toBe(1);
    expect(r.missed).toBe(0);
    expect(r.taken).toBe(1); // still "taken" — late is not folded into missed
    expect(r.expected).toBe(1);
  });

  it('the exact Journey 3 regression: doses 15h30m and 3h30m late no longer read as 100%', () => {
    const day1 = at('2026-06-14', '08:00');
    const day2 = at('2026-06-15', '08:00');
    const log = [
      logEntry({
        medId: 'sens',
        slotId: 's1',
        scheduledInstant: day1,
        actualInstant: day1 + (15 * 60 + 30) * 60_000, // 15h30m late
      }),
      logEntry({
        medId: 'sens',
        slotId: 's1',
        scheduledInstant: day2,
        actualInstant: day2 + (3 * 60 + 30) * 60_000, // 3h30m late
      }),
    ];
    const r = computeAdherence([s], [sensitive], log, ZONE, 2, 2, NOW);
    expect(r.expected).toBe(2);
    expect(r.late).toBe(2);
    expect(r.onTime).toBe(0);
    expect(r.ratio).toBe(0); // NOT 100% — this is the regression this FR closes
  });

  it('boundary: a dose exactly at the window edge counts as on time (inclusive)', () => {
    const scheduled = at('2026-06-15', '08:00');
    const atEdge = logEntry({
      medId: 'sens',
      slotId: 's1',
      scheduledInstant: scheduled,
      actualInstant: scheduled + 60 * 60_000, // exactly 60m late, window is 60m
    });
    const r = computeAdherence([s], [sensitive], [atEdge], ZONE, 1, 2, NOW, false, [], 60);
    expectFullyOnTime(r);
  });

  it('one minute past the window edge counts as late', () => {
    const scheduled = at('2026-06-15', '08:00');
    const justOver = logEntry({
      medId: 'sens',
      slotId: 's1',
      scheduledInstant: scheduled,
      actualInstant: scheduled + 61 * 60_000,
    });
    const r = computeAdherence([s], [sensitive], [justOver], ZONE, 1, 2, NOW, false, [], 60);
    expect(r.onTime).toBe(0);
    expect(r.late).toBe(1);
  });

  it('defaults the on-time window to DEFAULT_ON_TIME_WINDOW_MINUTES when not given', () => {
    const scheduled = at('2026-06-15', '08:00');
    const late = logEntry({
      medId: 'sens',
      slotId: 's1',
      scheduledInstant: scheduled,
      actualInstant: scheduled + (DEFAULT_ON_TIME_WINDOW_MINUTES + 1) * 60_000,
    });
    const r = computeAdherence([s], [sensitive], [late], ZONE, 1, 2, NOW);
    expect(r.onTimeWindowMinutes).toBe(DEFAULT_ON_TIME_WINDOW_MINUTES);
    expect(r.late).toBe(1);
  });

  it('an assumed-taken occurrence (no real entry) is always on time, never late', () => {
    const r = computeAdherence([s], [sensitive], [], ZONE, 1, 2, NOW, true);
    expectFullyOnTime(r);
  });

  it('widening the window reclassifies a previously-late dose as on time', () => {
    const scheduled = at('2026-06-15', '08:00');
    const log = [
      logEntry({
        medId: 'sens',
        slotId: 's1',
        scheduledInstant: scheduled,
        actualInstant: scheduled + 90 * 60_000,
      }),
    ];
    const tight = computeAdherence([s], [sensitive], log, ZONE, 1, 2, NOW, false, [], 60);
    expect(tight.late).toBe(1);
    expect(tight.onTime).toBe(0);

    const wide = computeAdherence([s], [sensitive], log, ZONE, 1, 2, NOW, false, [], 120);
    expect(wide.late).toBe(0);
    expect(wide.onTime).toBe(1);
    expect(wide.ratio).toBe(1);
  });
});

// Stage 18 FR-18.3 — skipped doses. A deliberate skip is reported as its own
// outcome: distinct from both taken (on-time or late) and missed, and — the
// design decision this FR settles — excluded from the expected/ratio
// denominator entirely, since a clinician-directed skip isn't a lapse.
describe('computeAdherence — FR-18.3: skipped doses', () => {
  const sensitive = med({ id: 'sens', adjustWhenLate: true });
  const s = slot({ id: 's1', time: '08:00', items: [{ medId: 'sens', dose: 100 }] });

  /** One taken-on-time entry and one skipped entry, on the given days. */
  function takenAndSkippedLog(takenDay: Instant, skippedDay: Instant) {
    return [
      logEntry({
        medId: 'sens',
        slotId: 's1',
        scheduledInstant: takenDay,
        actualInstant: takenDay,
        status: 'taken',
      }),
      logEntry({
        medId: 'sens',
        slotId: 's1',
        scheduledInstant: skippedDay,
        actualInstant: skippedDay,
        status: 'skipped',
        dose: 0,
      }),
    ];
  }

  it('AC6: skipped/missed/taken report as three distinct outcomes', () => {
    // 2026-06-15 (today, in NOW) is left unlogged → missed.
    const log = takenAndSkippedLog(at('2026-06-13', '08:00'), at('2026-06-14', '08:00'));
    const r = computeAdherence([s], [sensitive], log, ZONE, 3, 2, NOW);
    expect(r.onTime).toBe(1);
    expect(r.missed).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it('a skipped dose is excluded from `expected` and does not lower the ratio', () => {
    const log = takenAndSkippedLog(at('2026-06-14', '08:00'), at('2026-06-15', '08:00'));
    const r = computeAdherence([s], [sensitive], log, ZONE, 2, 2, NOW);
    expect(r.expected).toBe(1); // the skipped occurrence is not in the denominator
    expect(r.skipped).toBe(1);
    expect(r.ratio).toBe(1); // 1/1, not diluted by the skip
  });

  it('a skipped dose never triggers the missed-pattern warning', () => {
    const log = ['2026-06-13', '2026-06-14', '2026-06-15'].map((d) =>
      logEntry({
        medId: 'sens',
        slotId: 's1',
        scheduledInstant: at(d, '08:00'),
        actualInstant: at(d, '08:00'),
        status: 'skipped',
        dose: 0,
      }),
    );
    const r = computeAdherence([s], [sensitive], log, ZONE, 3, 2, NOW);
    expect(r.skipped).toBe(3);
    expect(r.missed).toBe(0);
    expect(r.missedPatternWarning).toBe(false);
  });
});
