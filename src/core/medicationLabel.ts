// Stage 22 (P0 #3) — the single human-readable label for a medication.
//
// Pure and presentation-agnostic so the Meds list, the portable medication list
// (Stage 23), and any clinician output render one consistent string. It composes
// the descriptive identity fields only; it never touches doses or guardrails.
//
//   name only         -> "Levetiracetam"
//   + strength        -> "Levetiracetam 500 mg"
//   + form            -> "Levetiracetam — Tablet"
//   + both            -> "Levetiracetam 500 mg — Tablet"
//
// The `other` form carries no useful label text, so it is omitted.

import type { Medication, MedicationForm } from './types';

const FORM_LABELS: Record<MedicationForm, string> = {
  tablet: 'Tablet',
  capsule: 'Capsule',
  liquid: 'Liquid',
  injection: 'Injection',
  patch: 'Patch',
  inhaler: 'Inhaler',
  drops: 'Drops',
  cream: 'Cream',
  other: 'Other',
};

/** Human-readable display label for a dosage form; `undefined` when unset/other. */
export function formLabel(form: MedicationForm | undefined): string | undefined {
  if (form == null || form === 'other') return undefined;
  return FORM_LABELS[form];
}

/**
 * The medication's display label: name, plus strength when set, plus form when
 * set. Accepts the identity slice so callers can pass a full `Medication` or a
 * lighter shape (e.g. a snapshot copy).
 */
export function medicationLabel(med: Pick<Medication, 'name' | 'strength' | 'form'>): string {
  let label = med.name.trim();
  const strength = med.strength?.trim();
  if (strength) label += ` ${strength}`;
  const form = formLabel(med.form);
  if (form) label += ` — ${form}`;
  return label;
}
