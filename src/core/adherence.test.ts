import { describe, expect, it } from 'vitest';
import { computeAdherence } from './adherence';
import { resolveWallTimeToInstant } from './time';
import { logEntry, med, slot } from '../test/fixtures';

const ZONE = 'Europe/London';
const at = (date: string, time: string) => resolveWallTimeToInstant(date, time, ZONE);

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
