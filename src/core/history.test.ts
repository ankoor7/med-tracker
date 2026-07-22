import { describe, expect, it } from 'vitest';
import { adherenceTimeline, entryMarkers, filterLog } from './history';
import { resolveWallTimeToInstant } from './time';
import { logEntry, med, slot } from '../test/fixtures';

const ZONE = 'Europe/London';

const at = (date: string, time: string) => resolveWallTimeToInstant(date, time, ZONE);

describe('filterLog', () => {
  const log = [
    logEntry({ id: 'a', medId: 'm1', actualInstant: at('2026-06-10', '08:00'), zone: ZONE }),
    logEntry({ id: 'b', medId: 'm2', actualInstant: at('2026-06-12', '08:00'), zone: ZONE }),
    logEntry({ id: 'c', medId: 'm1', actualInstant: at('2026-06-15', '08:00'), zone: ZONE }),
    logEntry({
      id: 'd',
      medId: 'm1',
      actualInstant: at('2026-06-16', '08:00'),
      zone: ZONE,
      deleted: true,
    }),
  ];

  it('returns all non-deleted entries newest-first when unfiltered', () => {
    expect(filterLog(log, {}, ZONE).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('filters by medication (AC1)', () => {
    expect(filterLog(log, { medId: 'm1' }, ZONE).map((e) => e.id)).toEqual(['c', 'a']);
  });

  it('filters by inclusive local date range (AC1)', () => {
    expect(filterLog(log, { from: '2026-06-11', to: '2026-06-15' }, ZONE).map((e) => e.id)).toEqual(
      ['c', 'b'],
    );
  });

  it('combines medication and date filters', () => {
    expect(filterLog(log, { medId: 'm1', from: '2026-06-14' }, ZONE).map((e) => e.id)).toEqual([
      'c',
    ]);
  });
});

describe('entryMarkers', () => {
  it('flags adjusted, late, and over-cap', () => {
    const scheduled = at('2026-06-16', '08:00');
    const e = logEntry({
      scheduledInstant: scheduled,
      actualInstant: scheduled + 2 * 60 * 60_000,
      adjusted: true,
      warnings: ['over max single dose'],
    });
    expect(entryMarkers(e)).toEqual({ adjusted: true, late: true, overCap: true });
  });

  it('clears markers for an on-time, unadjusted, in-range dose', () => {
    const scheduled = at('2026-06-16', '08:00');
    const e = logEntry({
      scheduledInstant: scheduled,
      actualInstant: scheduled,
      adjusted: false,
      warnings: [],
    });
    expect(entryMarkers(e)).toEqual({ adjusted: false, late: false, overCap: false });
  });
});

describe('adherenceTimeline', () => {
  it('produces one taken/missed point per day over the window (AC2)', () => {
    const m = med({ id: 'm1', adjustWhenLate: true });
    const slots = [slot({ id: 's1', time: '08:00', items: [{ medId: 'm1', dose: 100 }] })];
    // Day 1 taken, day 2 missed. Evaluate at end of day 2.
    const taken = logEntry({
      medId: 'm1',
      slotId: 's1',
      scheduledInstant: at('2026-06-15', '08:00'),
      zone: ZONE,
      status: 'taken',
    });
    const now = at('2026-06-16', '23:00');
    const days = adherenceTimeline(slots, [m], [taken], ZONE, 2, now);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: '2026-06-15', taken: 1, missed: 0, expected: 1 });
    expect(days[1]).toMatchObject({ date: '2026-06-16', taken: 0, missed: 1, expected: 1 });
  });

  it('excludes flexible meds (only timing-sensitive scored)', () => {
    const flex = med({ id: 'm1', adjustWhenLate: false });
    const slots = [slot({ id: 's1', time: '08:00', items: [{ medId: 'm1', dose: 100 }] })];
    const now = at('2026-06-16', '23:00');
    const days = adherenceTimeline(slots, [flex], [], ZONE, 1, now);
    expect(days[0]).toMatchObject({ taken: 0, missed: 0, expected: 0 });
  });

  // Stage 18 FR-18.4/FR-18.3 — the chart must break out on-time/late/skipped
  // exactly as computeAdherence does (they share `classifyOccurrences`), so the
  // summary figure and the chart can never disagree.
  it('breaks out on-time, late, and skipped per day (FR-18.4, FR-18.3)', () => {
    const m = med({ id: 'm1', adjustWhenLate: true });
    const slots = [slot({ id: 's1', time: '08:00', items: [{ medId: 'm1', dose: 100 }] })];
    const onTimeDay = at('2026-06-14', '08:00');
    const lateDay = at('2026-06-15', '08:00');
    const skippedDay = at('2026-06-16', '08:00');
    const log = [
      logEntry({
        medId: 'm1',
        slotId: 's1',
        scheduledInstant: onTimeDay,
        actualInstant: onTimeDay,
        status: 'taken',
      }),
      logEntry({
        medId: 'm1',
        slotId: 's1',
        scheduledInstant: lateDay,
        actualInstant: lateDay + 2 * 60 * 60_000, // 2h late
        status: 'taken',
      }),
      logEntry({
        medId: 'm1',
        slotId: 's1',
        scheduledInstant: skippedDay,
        actualInstant: skippedDay,
        status: 'skipped',
        dose: 0,
      }),
    ];
    const now = at('2026-06-16', '23:00');
    const days = adherenceTimeline(slots, [m], log, ZONE, 3, now);
    expect(days[0]).toMatchObject({ date: '2026-06-14', onTime: 1, late: 0, expected: 1 });
    expect(days[1]).toMatchObject({ date: '2026-06-15', onTime: 0, late: 1, expected: 1 });
    expect(days[2]).toMatchObject({ date: '2026-06-16', skipped: 1, expected: 0 });
  });
});
