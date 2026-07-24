import { describe, expect, it } from 'vitest';
import { checkGuardrails, classifyGuardrailBreach, guardrailAckLabel } from './guardrails';
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

// Stage 18 FR-18.10: the guardrail acknowledgement button used to read
// "Log over-cap dose" unconditionally, which misnames a min-interval breach.
//
// Shared warning-list builders below (deduped per the fallow audit) — each
// exercises `checkGuardrails` for one breach shape so `classifyGuardrailBreach`
// and `guardrailAckLabel` tests aren't each re-deriving the same fixtures.

/** A single max-single-dose breach: unambiguously "over-cap". */
function overCapWarnings(): string[] {
  const m = med({
    guardrails: { maxSingleDose: 100, maxDailyDose: null, minIntervalHours: null },
  });
  return checkGuardrails(m, 150, at('2026-06-15', '08:00'), [], ZONE);
}

/** A single max-daily-dose breach: also "over-cap". */
function overCapDailyWarnings(): string[] {
  const m = med({
    id: 'a',
    guardrails: { maxSingleDose: null, maxDailyDose: 100, minIntervalHours: null },
  });
  return checkGuardrails(m, 150, at('2026-06-15', '08:00'), [], ZONE);
}

/** A dose taken 1h before the scenarios below use it — shared by both. */
const RECENT_TAKEN_DOSE = logEntry({
  medId: 'a',
  dose: 100,
  actualInstant: at('2026-06-15', '08:00'),
  status: 'taken',
});

/** A single min-interval breach: "too-soon", never "over-cap". */
function tooSoonWarnings(): string[] {
  const m = med({
    id: 'a',
    guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: 6 },
  });
  return checkGuardrails(m, 100, at('2026-06-15', '09:00'), [RECENT_TAKEN_DOSE], ZONE);
}

/** Both an over-cap and a too-soon breach at once: mixed, must not misname. */
function mixedBreachWarnings(): string[] {
  const m = med({
    id: 'a',
    guardrails: { maxSingleDose: 50, maxDailyDose: null, minIntervalHours: 6 },
  });
  return checkGuardrails(m, 100, at('2026-06-15', '09:00'), [RECENT_TAKEN_DOSE], ZONE);
}

describe('classifyGuardrailBreach', () => {
  it('returns null for no warnings', () => {
    expect(classifyGuardrailBreach([])).toBeNull();
  });

  it('classifies a max-single-dose breach as over-cap', () => {
    expect(classifyGuardrailBreach(overCapWarnings())).toBe('over-cap');
  });

  it('classifies a max-daily-dose breach as over-cap', () => {
    expect(classifyGuardrailBreach(overCapDailyWarnings())).toBe('over-cap');
  });

  it('classifies a min-interval (too-soon) breach as too-soon, NOT over-cap', () => {
    const w = tooSoonWarnings();
    expect(w).toHaveLength(1);
    expect(classifyGuardrailBreach(w)).toBe('too-soon');
    expect(classifyGuardrailBreach(w)).not.toBe('over-cap');
  });

  it('returns null (mixed) when both an over-cap and a too-soon warning are present', () => {
    const w = mixedBreachWarnings();
    expect(w.length).toBeGreaterThanOrEqual(2);
    expect(classifyGuardrailBreach(w)).toBeNull();
  });
});

describe('guardrailAckLabel', () => {
  it('names the over-cap breach specifically', () => {
    expect(guardrailAckLabel(overCapWarnings(), 'Log')).toBe('Log over-cap dose');
  });

  it('names the too-soon breach specifically, and never calls it "over-cap"', () => {
    const label = guardrailAckLabel(tooSoonWarnings(), 'Log');
    expect(label).toBe('Log too-soon dose');
    expect(label).not.toMatch(/over-cap/i);
  });

  it('falls back to a safe generic label for mixed/unrecognised breaches', () => {
    expect(guardrailAckLabel(mixedBreachWarnings(), 'Log')).toBe('Log dose anyway');
  });
});
