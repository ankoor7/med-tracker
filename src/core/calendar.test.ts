import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PX_PER_HOUR,
  clampInstant,
  dayEndInstant,
  dayStartInstant,
  dayYToInstant,
  instantToDayY,
  resolveDraggedInstant,
} from './calendar';
import { resolveWallTimeToInstant, wallTimeInZone } from './time';

const LONDON = 'Europe/London';
const MIN = 60_000;
const PX = DEFAULT_PX_PER_HOUR;

describe('day boundaries (active zone)', () => {
  it('starts and ends at midnight in the active zone, not the host', () => {
    // Summer day: London is BST (+1h), so local midnight is 23:00 UTC the day before.
    const start = dayStartInstant('2026-07-15', LONDON);
    const end = dayEndInstant('2026-07-15', LONDON);
    expect(wallTimeInZone(start, LONDON)).toBe('00:00');
    expect(wallTimeInZone(end, LONDON)).toBe('00:00');
    expect(start).toBe(Date.UTC(2026, 6, 14, 23, 0));
    expect(end).toBe(Date.UTC(2026, 6, 15, 23, 0));
  });

  it('a normal day spans 24 hours', () => {
    const start = dayStartInstant('2026-07-15', LONDON);
    const end = dayEndInstant('2026-07-15', LONDON);
    expect((end - start) / (60 * MIN)).toBe(24);
  });

  it('a UK spring-forward day spans 23 hours', () => {
    // Clocks jump 01:00→02:00 GMT on 2026-03-29.
    const start = dayStartInstant('2026-03-29', LONDON);
    const end = dayEndInstant('2026-03-29', LONDON);
    expect((end - start) / (60 * MIN)).toBe(23);
  });
});

describe('instant ⇄ pixel mapping', () => {
  it('maps midnight to the top and round-trips a wall time', () => {
    const start = dayStartInstant('2026-07-15', LONDON);
    expect(instantToDayY(start, start, PX)).toBe(0);

    const eight = resolveWallTimeToInstant('2026-07-15', '08:00', LONDON);
    const y = instantToDayY(eight, start, PX);
    expect(y).toBe(8 * PX);
    expect(dayYToInstant(y, start, PX)).toBe(eight);
  });
});

describe('clampInstant', () => {
  it('bounds to the inclusive range', () => {
    expect(clampInstant(5, 0, 10)).toBe(5);
    expect(clampInstant(-1, 0, 10)).toBe(0);
    expect(clampInstant(11, 0, 10)).toBe(10);
  });
});

describe('resolveDraggedInstant', () => {
  const start = dayStartInstant('2026-07-15', LONDON);
  const end = dayEndInstant('2026-07-15', LONDON);
  const eight = resolveWallTimeToInstant('2026-07-15', '08:00', LONDON);

  it('converts a downward drag into a later, 5-min-snapped time', () => {
    // Drag down by 1.5 rows ≈ 90 min; expect 09:30 (already on the grid).
    const result = resolveDraggedInstant({
      originalInstant: eight,
      deltaY: 1.5 * PX,
      pxPerHour: PX,
      min: start,
      max: end,
    });
    expect(wallTimeInZone(result, LONDON)).toBe('09:30');
  });

  it('drags upward (earlier) and snaps to the nearest 5 minutes', () => {
    // Up by ~22 px at 48px/h ≈ 27.5 min earlier → 07:32.5 → snaps to 07:35... check.
    const result = resolveDraggedInstant({
      originalInstant: eight,
      deltaY: -0.2 * PX, // 12 min earlier → 07:48
      pxPerHour: PX,
      min: start,
      max: end,
    });
    expect(wallTimeInZone(result, LONDON)).toBe('07:50');
  });

  it('snaps an off-grid delta to the nearest step', () => {
    // +0.05 rows = +3 min → 08:03 → snaps to 08:05.
    const result = resolveDraggedInstant({
      originalInstant: eight,
      deltaY: 0.05 * PX,
      pxPerHour: PX,
      min: start,
      max: end,
    });
    expect(wallTimeInZone(result, LONDON)).toBe('08:05');
  });

  it('clamps to the day start and never drags before midnight', () => {
    const result = resolveDraggedInstant({
      originalInstant: eight,
      deltaY: -100 * PX, // way past the top
      pxPerHour: PX,
      min: start,
      max: end,
    });
    expect(result).toBe(start);
    expect(wallTimeInZone(result, LONDON)).toBe('00:00');
  });

  it('clamps to the supplied max (e.g. "now") on a large downward drag', () => {
    const noon = resolveWallTimeToInstant('2026-07-15', '12:00', LONDON);
    const result = resolveDraggedInstant({
      originalInstant: eight,
      deltaY: 100 * PX,
      pxPerHour: PX,
      min: start,
      max: noon, // pretend "now" is noon
    });
    expect(result).toBe(noon);
  });

  it('honours a custom snap step', () => {
    // 15-min grid: +7 min → snaps to 08:00 (nearest 15).
    const result = resolveDraggedInstant({
      originalInstant: eight,
      deltaY: (7 / 60) * PX,
      pxPerHour: PX,
      min: start,
      max: end,
      stepMs: 15 * MIN,
    });
    expect(wallTimeInZone(result, LONDON)).toBe('08:00');
  });
});
