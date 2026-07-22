import { describe, expect, it } from 'vitest';
import {
  hasDoseLoggedBefore,
  isFutureStartDate,
  medicationsMissingStartDate,
  needsStartDatePrompt,
  startOfDayInstant,
} from './startDate';
import { resolveWallTimeToInstant } from './time';
import { logEntry, med } from '../test/fixtures';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';
const at = (date: string, time: string, zone = LONDON) =>
  resolveWallTimeToInstant(date, time, zone);

describe('startOfDayInstant', () => {
  it('resolves to midnight in the given zone', () => {
    expect(startOfDayInstant('2026-06-15', LONDON)).toBe(at('2026-06-15', '00:00'));
  });

  // Zone-boundary case: "started today" is a different absolute instant
  // depending on which zone "today" is read in — never a bare Date.now() cutoff.
  it('resolves the same calendar date to different instants in different zones', () => {
    const london = startOfDayInstant('2026-06-15', LONDON);
    const newYork = startOfDayInstant('2026-06-15', NEW_YORK);
    expect(london).not.toBe(newYork);
    // New York is behind London, so its midnight is a later UTC instant.
    expect(newYork).toBeGreaterThan(london);
  });
});

describe('isFutureStartDate', () => {
  const now = at('2026-06-15', '12:00');

  it('is false for today and past dates', () => {
    expect(isFutureStartDate('2026-06-15', now, LONDON)).toBe(false);
    expect(isFutureStartDate('2026-06-01', now, LONDON)).toBe(false);
  });

  it('is true for a date after today', () => {
    expect(isFutureStartDate('2026-06-16', now, LONDON)).toBe(true);
  });

  it('reads "today" relative to the given zone, not the host zone', () => {
    // Late in the UK evening it's already the next calendar day in a zone far
    // enough east — so the same instant can read as "future" in one zone and
    // "today" in another.
    const lateUk = at('2026-06-15', '23:30');
    expect(isFutureStartDate('2026-06-16', lateUk, 'Pacific/Auckland')).toBe(false);
    expect(isFutureStartDate('2026-06-16', lateUk, LONDON)).toBe(true);
  });
});

describe('hasDoseLoggedBefore', () => {
  const startedAt = at('2026-06-10', '00:00');

  it('is true when a non-deleted dose for the medication predates startedAt', () => {
    const log = [
      logEntry({ medId: 'm1', actualInstant: at('2026-06-05', '08:00') }),
      logEntry({ medId: 'm2', actualInstant: at('2026-06-01', '08:00') }),
    ];
    expect(hasDoseLoggedBefore(log, 'm1', startedAt)).toBe(true);
  });

  it('is false when the only prior dose belongs to a different medication', () => {
    const log = [logEntry({ medId: 'm2', actualInstant: at('2026-06-01', '08:00') })];
    expect(hasDoseLoggedBefore(log, 'm1', startedAt)).toBe(false);
  });

  it('is false when the earlier entry is deleted', () => {
    const log = [
      logEntry({ medId: 'm1', actualInstant: at('2026-06-05', '08:00'), deleted: true }),
    ];
    expect(hasDoseLoggedBefore(log, 'm1', startedAt)).toBe(false);
  });

  it('is false when all doses are on/after startedAt', () => {
    const log = [logEntry({ medId: 'm1', actualInstant: at('2026-06-10', '08:00') })];
    expect(hasDoseLoggedBefore(log, 'm1', startedAt)).toBe(false);
  });
});

describe('medicationsMissingStartDate', () => {
  it('returns only non-deleted medications missing startedAt', () => {
    const withDate = med({ id: 'a', startedAt: 1 });
    const missing = med({ id: 'b', startedAt: undefined });
    const deletedMissing = med({ id: 'c', startedAt: undefined, deleted: true });
    expect(medicationsMissingStartDate([withDate, missing, deletedMissing])).toEqual([missing]);
  });
});

describe('needsStartDatePrompt', () => {
  it('is false when every non-deleted medication has a startedAt (fresh install)', () => {
    const meds = [med({ startedAt: 1 }), med({ startedAt: 2 })];
    expect(needsStartDatePrompt(meds)).toBe(false);
  });

  it('is true when any non-deleted medication is missing startedAt', () => {
    const meds = [med({ startedAt: 1 }), med({ startedAt: undefined })];
    expect(needsStartDatePrompt(meds)).toBe(true);
  });

  it('ignores deleted medications missing startedAt', () => {
    const meds = [med({ startedAt: undefined, deleted: true })];
    expect(needsStartDatePrompt(meds)).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(needsStartDatePrompt([])).toBe(false);
  });
});
