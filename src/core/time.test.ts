import { describe, expect, it } from 'vitest';
import {
  addDaysToIsoDate,
  datetimeLocalToInstant,
  formatTimeWithZone,
  hoursBetween,
  instantToDatetimeLocal,
  isoDateInZone,
  resolveWallTimeToInstant,
  wallTimeInZone,
  zoneAbbreviation,
  zoneOffsetMs,
  roundInstantToStep,
  describeOffset,
} from './time';

const LONDON = 'Europe/London';
const HOUR = 3_600_000;

describe('zoneOffsetMs', () => {
  it('is 0 for London in winter (GMT)', () => {
    const winter = Date.UTC(2026, 0, 15, 12, 0, 0); // 15 Jan 2026
    expect(zoneOffsetMs(winter, LONDON)).toBe(0);
  });

  it('is +1h for London in summer (BST)', () => {
    const summer = Date.UTC(2026, 6, 15, 12, 0, 0); // 15 Jul 2026
    expect(zoneOffsetMs(summer, LONDON)).toBe(HOUR);
  });
});

describe('resolveWallTimeToInstant', () => {
  it('resolves a GMT wall time to the right UTC instant', () => {
    // 08:00 on a winter day == 08:00 UTC.
    const i = resolveWallTimeToInstant('2026-01-15', '08:00', LONDON);
    expect(i).toBe(Date.UTC(2026, 0, 15, 8, 0));
    expect(wallTimeInZone(i, LONDON)).toBe('08:00');
  });

  it('resolves a BST wall time to UTC-1h', () => {
    // 08:00 BST == 07:00 UTC.
    const i = resolveWallTimeToInstant('2026-07-15', '08:00', LONDON);
    expect(i).toBe(Date.UTC(2026, 6, 15, 7, 0));
    expect(wallTimeInZone(i, LONDON)).toBe('08:00');
  });

  it('round-trips wall time across both DST states', () => {
    for (const date of ['2026-01-15', '2026-07-15']) {
      const i = resolveWallTimeToInstant(date, '22:30', LONDON);
      expect(wallTimeInZone(i, LONDON)).toBe('22:30');
      expect(isoDateInZone(i, LONDON)).toBe(date);
    }
  });
});

describe('zone abbreviation (BST/GMT)', () => {
  it('shows GMT in winter and BST in summer', () => {
    const winter = resolveWallTimeToInstant('2026-01-15', '12:00', LONDON);
    const summer = resolveWallTimeToInstant('2026-07-15', '12:00', LONDON);
    expect(zoneAbbreviation(winter, LONDON)).toBe('GMT');
    expect(zoneAbbreviation(summer, LONDON)).toBe('BST');
    expect(formatTimeWithZone(summer, LONDON)).toBe('12:00 BST');
  });
});

describe('DST-boundary intervals (Stage 1 AC8)', () => {
  it('BST→GMT (autumn): evening 22:00 to next 08:00 is 11 real hours (clocks back)', () => {
    // 2026 UK clocks go back on 2026-10-25 (last Sunday of October).
    const evening = resolveWallTimeToInstant('2026-10-24', '22:00', LONDON); // BST
    const morning = resolveWallTimeToInstant('2026-10-25', '08:00', LONDON); // GMT
    expect(hoursBetween(evening, morning)).toBe(11);
  });

  it('GMT→BST (spring): evening 22:00 to next 08:00 is 9 real hours (clocks forward)', () => {
    // 2026 UK clocks go forward on 2026-03-29 (last Sunday of March).
    const evening = resolveWallTimeToInstant('2026-03-28', '22:00', LONDON); // GMT
    const morning = resolveWallTimeToInstant('2026-03-29', '08:00', LONDON); // BST
    expect(hoursBetween(evening, morning)).toBe(9);
  });

  it('a normal night is exactly 10 hours', () => {
    const evening = resolveWallTimeToInstant('2026-07-14', '22:00', LONDON);
    const morning = resolveWallTimeToInstant('2026-07-15', '08:00', LONDON);
    expect(hoursBetween(evening, morning)).toBe(10);
  });
});

describe('datetime-local conversion uses the active zone, not the host', () => {
  it('interprets the input string in the given zone', () => {
    const i = datetimeLocalToInstant('2026-07-15T08:30', LONDON);
    expect(i).toBe(Date.UTC(2026, 6, 15, 7, 30)); // BST → -1h
  });

  it('round-trips instant ↔ datetime-local', () => {
    const i = resolveWallTimeToInstant('2026-01-15', '09:45', LONDON);
    expect(instantToDatetimeLocal(i, LONDON)).toBe('2026-01-15T09:45');
  });
});

describe('addDaysToIsoDate', () => {
  it('adds and subtracts across month boundaries', () => {
    expect(addDaysToIsoDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToIsoDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToIsoDate('2026-06-15', -6)).toBe('2026-06-09');
  });
});

const MIN = 60_000;

describe('roundInstantToStep (Stage 11)', () => {
  it('rounds to the nearest 5 minutes by default', () => {
    const base = Date.UTC(2026, 6, 15, 8, 0); // 08:00
    expect(roundInstantToStep(base + 2 * MIN)).toBe(base); // 08:02 → 08:00
    expect(roundInstantToStep(base + 3 * MIN)).toBe(base + 5 * MIN); // 08:03 → 08:05
    expect(roundInstantToStep(base + 7 * MIN)).toBe(base + 5 * MIN); // 08:07 → 08:05
    expect(roundInstantToStep(base)).toBe(base); // exact
  });
});

describe('describeOffset (Stage 11)', () => {
  const sched = Date.UTC(2026, 6, 15, 8, 0);
  it('labels late, early, and on-time', () => {
    expect(describeOffset(sched + 150 * MIN, sched)).toBe('2h 30m late');
    expect(describeOffset(sched - 10 * MIN, sched)).toBe('10m early');
    expect(describeOffset(sched + 60 * MIN, sched)).toBe('1h late');
    expect(describeOffset(sched + 30_000, sched)).toBe('on time'); // within 1 min
  });

  it('is DST-agnostic (compares elapsed ms across a UK spring-forward)', () => {
    // 2026-03-29 01:00 UTC, 30 real minutes later spans the BST transition.
    const s = Date.UTC(2026, 2, 29, 0, 30);
    expect(describeOffset(s + 30 * MIN, s)).toBe('30m late');
  });
});
