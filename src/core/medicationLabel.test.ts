import { describe, expect, it } from 'vitest';
import { formLabel, medicationLabel } from './medicationLabel';
import type { MedicationForm } from './types';

describe('medicationLabel (Stage 22, FR-22.3)', () => {
  it('renders the bare name when neither strength nor form is set', () => {
    expect(medicationLabel({ name: 'Levetiracetam' })).toBe('Levetiracetam');
  });

  it('appends strength when set', () => {
    expect(medicationLabel({ name: 'Levetiracetam', strength: '500 mg' })).toBe(
      'Levetiracetam 500 mg',
    );
  });

  it('appends form when set', () => {
    expect(medicationLabel({ name: 'Levetiracetam', form: 'tablet' })).toBe(
      'Levetiracetam — Tablet',
    );
  });

  it('appends both strength and form when set', () => {
    expect(medicationLabel({ name: 'Levetiracetam', strength: '500 mg', form: 'tablet' })).toBe(
      'Levetiracetam 500 mg — Tablet',
    );
  });

  it('omits the "other" form (it carries no useful label text)', () => {
    expect(medicationLabel({ name: 'Compound', strength: '5 mg/mL', form: 'other' })).toBe(
      'Compound 5 mg/mL',
    );
  });

  it('ignores a whitespace-only strength and trims the name', () => {
    expect(medicationLabel({ name: '  Lamotrigine  ', strength: '   ' })).toBe('Lamotrigine');
  });
});

describe('formLabel', () => {
  it('maps each concrete form to a title-cased label', () => {
    const cases: [MedicationForm, string | undefined][] = [
      ['tablet', 'Tablet'],
      ['capsule', 'Capsule'],
      ['liquid', 'Liquid'],
      ['injection', 'Injection'],
      ['patch', 'Patch'],
      ['inhaler', 'Inhaler'],
      ['drops', 'Drops'],
      ['cream', 'Cream'],
    ];
    for (const [form, label] of cases) expect(formLabel(form)).toBe(label);
  });

  it('returns undefined for an unset or "other" form', () => {
    expect(formLabel(undefined)).toBeUndefined();
    expect(formLabel('other')).toBeUndefined();
  });
});
