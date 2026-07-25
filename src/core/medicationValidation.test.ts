import { describe, expect, it } from 'vitest';
import {
  MAX_STRENGTH_LENGTH,
  validateMedication,
  type MedicationNameCandidate,
} from './medicationValidation';
import type { Guardrails } from './types';

const noCaps: Guardrails = { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null };

function others(...cs: MedicationNameCandidate[]): MedicationNameCandidate[] {
  return cs;
}

describe('validateMedication — strength (Stage 22, FR-22.2)', () => {
  it('accepts an absent, blank, or normal-length strength', () => {
    for (const strength of [undefined, '', '   ', '500 mg', '5 mg/mL']) {
      const issues = validateMedication({
        name: 'Levetiracetam',
        strength,
        guardrails: noCaps,
        slotDoses: [100],
        others: [],
      });
      expect(issues.some((i) => i.field === 'strength')).toBe(false);
    }
  });

  it('rejects a strength longer than the cap (measured after trimming)', () => {
    const issues = validateMedication({
      name: 'Levetiracetam',
      strength: `  ${'x'.repeat(MAX_STRENGTH_LENGTH + 1)}  `,
      guardrails: noCaps,
      slotDoses: [100],
      others: [],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'strength', code: 'strength-too-long' }),
    );
  });

  it('accepts a strength exactly at the cap', () => {
    const issues = validateMedication({
      name: 'Levetiracetam',
      strength: 'x'.repeat(MAX_STRENGTH_LENGTH),
      guardrails: noCaps,
      slotDoses: [100],
      others: [],
    });
    expect(issues.some((i) => i.field === 'strength')).toBe(false);
  });
});

describe('validateMedication — name (AC8, FR-18.8)', () => {
  it('rejects an empty/whitespace-only name', () => {
    const issues = validateMedication({
      name: '   ',
      guardrails: noCaps,
      slotDoses: [100],
      others: [],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'name', code: 'name-required' }),
    );
  });

  it('rejects a duplicate name against another active medication, case-insensitively and trimmed', () => {
    const issues = validateMedication({
      name: '  lamotrigine ',
      guardrails: noCaps,
      slotDoses: [100],
      others: others({ id: 'm2', name: 'Lamotrigine', active: true }),
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'name', code: 'name-duplicate' }),
    );
  });

  it('does not flag the medication being edited as its own duplicate', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: noCaps,
      slotDoses: [100],
      medId: 'm1',
      others: others({ id: 'm1', name: 'Lamotrigine', active: true }),
    });
    expect(issues.some((i) => i.code === 'name-duplicate')).toBe(false);
  });

  it('does not flag a name shared with an inactive (stopped) medication', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: noCaps,
      slotDoses: [100],
      others: others({ id: 'm2', name: 'Lamotrigine', active: false }),
    });
    expect(issues.some((i) => i.code === 'name-duplicate')).toBe(false);
  });

  it('does not flag a name shared with a deleted (tombstoned) medication', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: noCaps,
      slotDoses: [100],
      others: others({ id: 'm2', name: 'Lamotrigine', active: true, deleted: true }),
    });
    expect(issues.some((i) => i.code === 'name-duplicate')).toBe(false);
  });

  it('allows a unique name against other active medications', () => {
    const issues = validateMedication({
      name: 'Levetiracetam',
      guardrails: noCaps,
      slotDoses: [100],
      others: others({ id: 'm2', name: 'Lamotrigine', active: true }),
    });
    expect(issues.some((i) => i.field === 'name')).toBe(false);
  });
});

describe('validateMedication — empty schedule (FR-18.7)', () => {
  it('rejects zero scheduled times', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: noCaps,
      slotDoses: [],
      others: [],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'schedule', code: 'schedule-empty' }),
    );
  });

  it('allows at least one scheduled time', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: noCaps,
      slotDoses: [100],
      others: [],
    });
    expect(issues.some((i) => i.field === 'schedule')).toBe(false);
  });
});

describe('validateMedication — negative/zero guardrails (AC8, FR-18.8)', () => {
  it.each(['maxSingleDose', 'maxDailyDose', 'minIntervalHours'] as const)(
    'rejects a negative %s',
    (key) => {
      const issues = validateMedication({
        name: 'Lamotrigine',
        guardrails: { ...noCaps, [key]: -5 },
        slotDoses: [100],
        others: [],
      });
      expect(issues).toContainEqual(
        expect.objectContaining({ field: key, code: `${key}-not-positive` }),
      );
    },
  );

  it.each(['maxSingleDose', 'maxDailyDose', 'minIntervalHours'] as const)(
    'rejects a zero %s',
    (key) => {
      const issues = validateMedication({
        name: 'Lamotrigine',
        guardrails: { ...noCaps, [key]: 0 },
        slotDoses: [100],
        others: [],
      });
      expect(issues).toContainEqual(
        expect.objectContaining({ field: key, code: `${key}-not-positive` }),
      );
    },
  );

  it('leaves an unset (null) guardrail unflagged — no cap is a valid choice', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: noCaps,
      slotDoses: [100],
      others: [],
    });
    expect(issues).toEqual([]);
  });

  it('allows a positive guardrail', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: { maxSingleDose: 200, maxDailyDose: 400, minIntervalHours: 6 },
      slotDoses: [100],
      others: [],
    });
    expect(issues).toEqual([]);
  });
});

describe('validateMedication — daily total vs maxDailyDose (AC8, FR-18.8)', () => {
  it('rejects a daily total over the cap, summing per-time-of-day slot doses', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: { ...noCaps, maxDailyDose: 400 },
      slotDoses: [200, 200, 200],
      others: [],
      unit: 'mg',
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'dailyTotal', code: 'daily-total-exceeds-cap' }),
    );
    const issue = issues.find((i) => i.code === 'daily-total-exceeds-cap');
    expect(issue?.message).toContain('600mg');
    expect(issue?.message).toContain('400mg');
  });

  it('passes when the daily total is exactly at the cap (boundary)', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: { ...noCaps, maxDailyDose: 400 },
      slotDoses: [200, 200],
      others: [],
    });
    expect(issues.some((i) => i.field === 'dailyTotal')).toBe(false);
  });

  it('passes when the daily total is under the cap', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: { ...noCaps, maxDailyDose: 400 },
      slotDoses: [150],
      others: [],
    });
    expect(issues.some((i) => i.field === 'dailyTotal')).toBe(false);
  });

  it('does not check the daily total when no cap is set', () => {
    const issues = validateMedication({
      name: 'Lamotrigine',
      guardrails: noCaps,
      slotDoses: [1000, 1000],
      others: [],
    });
    expect(issues.some((i) => i.field === 'dailyTotal')).toBe(false);
  });
});

describe('validateMedication — a fully valid medication', () => {
  it('returns no issues', () => {
    const issues = validateMedication({
      name: 'Levetiracetam',
      guardrails: { maxSingleDose: 500, maxDailyDose: 1000, minIntervalHours: 8 },
      slotDoses: [500, 500],
      others: others({ id: 'm2', name: 'Lamotrigine', active: true }),
    });
    expect(issues).toEqual([]);
  });
});
