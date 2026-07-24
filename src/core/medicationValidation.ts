// Stage 18 FR-18.7 / FR-18.8 — validating a medication before it is saved.
//
// Pure, so it is unit-testable in isolation and so `src/core` stays free of
// React/Zustand (see CLAUDE.md). The app never originates a dose value here —
// every number checked below was typed in by the user (a slot dose or a
// guardrail cap); this only rejects combinations that are never sensible,
// it never computes or suggests one.
//
// Three gaps this closes, all found by exercising `MedicationEditor`:
//   - FR-18.7: a medication with zero scheduled times is saveable and then
//     invisible everywhere (Today/Calendar/dose-log key off slots). There is
//     no PRN/as-needed concept in the domain (see `Medication` in `types.ts`),
//     so the only sound fix is to block the save outright.
//   - FR-18.8: a second, indistinguishable medication name; a negative or
//     zero guardrail cap (the HTML `min="0"` on those inputs is cosmetic
//     only); and a set of slot doses whose daily total silently exceeds
//     `maxDailyDose`.

import type { Guardrails } from './types';

export type MedicationValidationField =
  | 'name'
  | 'schedule'
  | 'maxSingleDose'
  | 'maxDailyDose'
  | 'minIntervalHours'
  | 'dailyTotal';

export interface MedicationValidationIssue {
  field: MedicationValidationField;
  code: string;
  message: string;
}

/** The slice of another medication this validator needs to spot a duplicate name. */
export interface MedicationNameCandidate {
  id: string;
  name: string;
  active: boolean;
  deleted?: boolean;
}

export interface ValidateMedicationInput {
  /** The name as entered; comparison trims and lower-cases it. */
  name: string;
  guardrails: Guardrails;
  /**
   * The dose entered for every row in the editor's "times & doses" list —
   * one per scheduled time, in row order. An empty array is what FR-18.7
   * blocks: a medication with no way to appear anywhere.
   */
  slotDoses: number[];
  /** Every other medication the store knows about (any active/deleted state). */
  others: MedicationNameCandidate[];
  /** The id of the medication being edited, so it never flags itself as a duplicate. */
  medId?: string;
  /** Unit label used only to make the daily-total message concrete, e.g. "mg". */
  unit?: string;
}

const GUARDRAIL_LABELS: Record<'maxSingleDose' | 'maxDailyDose' | 'minIntervalHours', string> = {
  maxSingleDose: 'Max single dose',
  maxDailyDose: 'Max daily dose',
  minIntervalHours: 'Min interval',
};

/**
 * Validates a medication (identity + guardrails + the slot doses the editor
 * plans to save it with) before it reaches the store. Returns every issue
 * found, not just the first — the editor can decide how many to show.
 */
export function validateMedication(input: ValidateMedicationInput): MedicationValidationIssue[] {
  const issues: MedicationValidationIssue[] = [];
  const trimmedName = input.name.trim();

  if (trimmedName.length === 0) {
    issues.push({ field: 'name', code: 'name-required', message: 'Name is required.' });
  } else {
    // Duplicate check is scoped to OTHER *active*, non-deleted medications: an
    // inactive ("stopped taking") or tombstoned medication is not currently
    // administered, so a same-named active one is not the dose-confusion risk
    // this guards against, and a user should be free to reuse a retired name.
    const dupe = input.others.some(
      (m) =>
        m.id !== input.medId &&
        m.active &&
        !m.deleted &&
        m.name.trim().toLowerCase() === trimmedName.toLowerCase(),
    );
    if (dupe) {
      issues.push({
        field: 'name',
        code: 'name-duplicate',
        message: `Another active medication is already named “${trimmedName}”. Use a different name, or edit that one instead, to avoid dose confusion.`,
      });
    }
  }

  if (input.slotDoses.length === 0) {
    issues.push({
      field: 'schedule',
      code: 'schedule-empty',
      message:
        'Add at least one time. A medication with no scheduled time never appears on Today, Calendar or the dose log.',
    });
  }

  for (const key of ['maxSingleDose', 'maxDailyDose', 'minIntervalHours'] as const) {
    const v = input.guardrails[key];
    if (v != null && !(v > 0)) {
      issues.push({
        field: key,
        code: `${key}-not-positive`,
        message: `${GUARDRAIL_LABELS[key]} must be greater than 0 — leave it blank for no cap.`,
      });
    }
  }

  const cap = input.guardrails.maxDailyDose;
  if (cap != null && cap > 0) {
    const total = input.slotDoses.reduce((sum, dose) => sum + (dose > 0 ? dose : 0), 0);
    if (total > cap) {
      const unit = input.unit ?? '';
      issues.push({
        field: 'dailyTotal',
        code: 'daily-total-exceeds-cap',
        message: `Scheduled doses total ${total}${unit}/day, which exceeds the max daily dose of ${cap}${unit}.`,
      });
    }
  }

  return issues;
}
