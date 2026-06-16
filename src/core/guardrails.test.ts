import { describe, expect, it } from 'vitest';
import { checkGuardrails } from './guardrails';
import { resolveWallTimeToInstant } from './time';
import { logEntry, med } from '../test/fixtures';

const ZONE = 'Europe/London';
const at = (date: string, time: string) => resolveWallTimeToInstant(date, time, ZONE);

describe('checkGuardrails', () => {
  it('returns no warnings within all caps', () => {
    const m = med({ guardrails: { maxSingleDose: 200, maxDailyDose: 400, minIntervalHours: 6 } });
    expect(checkGuardrails(m, 100, at('2026-06-15', '08:00'), [], ZONE)).toEqual([]);
  });

  it('warns when a single dose exceeds maxSingleDose', () => {
    const m = med({
      guardrails: { maxSingleDose: 100, maxDailyDose: null, minIntervalHours: null },
    });
    const w = checkGuardrails(m, 150, at('2026-06-15', '08:00'), [], ZONE);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/max single dose/i);
  });

  it('warns when the projected daily total exceeds maxDailyDose', () => {
    const m = med({
      id: 'a',
      guardrails: { maxSingleDose: null, maxDailyDose: 300, minIntervalHours: null },
    });
    const earlier = logEntry({
      medId: 'a',
      dose: 200,
      actualInstant: at('2026-06-15', '08:00'),
      status: 'taken',
    });
    const w = checkGuardrails(m, 150, at('2026-06-15', '20:00'), [earlier], ZONE);
    expect(w[0]).toMatch(/max daily dose/i);
  });

  it('does not sum doses from a different calendar day', () => {
    const m = med({
      id: 'a',
      guardrails: { maxSingleDose: null, maxDailyDose: 300, minIntervalHours: null },
    });
    const yesterday = logEntry({
      medId: 'a',
      dose: 200,
      actualInstant: at('2026-06-14', '20:00'),
      status: 'taken',
    });
    expect(checkGuardrails(m, 150, at('2026-06-15', '08:00'), [yesterday], ZONE)).toEqual([]);
  });

  it('warns when below minIntervalHours since the last dose', () => {
    const m = med({
      id: 'a',
      guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: 6 },
    });
    const recent = logEntry({
      medId: 'a',
      dose: 100,
      actualInstant: at('2026-06-15', '08:00'),
      status: 'taken',
    });
    const w = checkGuardrails(m, 100, at('2026-06-15', '11:00'), [recent], ZONE);
    expect(w[0]).toMatch(/min interval/i);
  });

  it('does not warn on interval when the gap is sufficient', () => {
    const m = med({
      id: 'a',
      guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: 6 },
    });
    const recent = logEntry({
      medId: 'a',
      dose: 100,
      actualInstant: at('2026-06-15', '08:00'),
      status: 'taken',
    });
    expect(checkGuardrails(m, 100, at('2026-06-15', '15:00'), [recent], ZONE)).toEqual([]);
  });

  it('ignores tombstoned and other meds prior doses', () => {
    const m = med({
      id: 'a',
      guardrails: { maxSingleDose: null, maxDailyDose: 300, minIntervalHours: null },
    });
    const deleted = logEntry({
      medId: 'a',
      dose: 200,
      actualInstant: at('2026-06-15', '08:00'),
      deleted: true,
    });
    const other = logEntry({ medId: 'b', dose: 200, actualInstant: at('2026-06-15', '08:00') });
    expect(checkGuardrails(m, 150, at('2026-06-15', '20:00'), [deleted, other], ZONE)).toEqual([]);
  });

  it('can return multiple warnings at once', () => {
    const m = med({
      id: 'a',
      guardrails: { maxSingleDose: 100, maxDailyDose: 150, minIntervalHours: 6 },
    });
    const recent = logEntry({
      medId: 'a',
      dose: 100,
      actualInstant: at('2026-06-15', '08:00'),
      status: 'taken',
    });
    const w = checkGuardrails(m, 200, at('2026-06-15', '10:00'), [recent], ZONE);
    expect(w.length).toBeGreaterThanOrEqual(3);
  });
});
