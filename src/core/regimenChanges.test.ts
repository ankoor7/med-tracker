import { describe, expect, it } from 'vitest';
import {
  buildRegimenChange,
  describeMedicationAdded,
  describeMedicationReactivated,
  describeMedicationRetired,
  describeMedicationSlotCascade,
  describeSlot,
  diffMedication,
  diffSlot,
  formatDose,
  groupChangesByDay,
  isStructuredFieldChange,
  slotSubject,
} from './regimenChanges';
import type { Medication, RegimenChange, RegimenFieldChange } from './types';
import { med, slot } from '../test/fixtures';

const ZONE = 'Europe/London';

describe('diffMedication', () => {
  it('returns no changes for an identical medication', () => {
    const a = med({ id: 'a', name: 'Lamotrigine', unit: 'mg' });
    expect(diffMedication(a, { ...a })).toEqual([]);
  });

  it('reports name, timing-sensitivity, and guardrail changes in display form', () => {
    const prev = med({
      id: 'a',
      name: 'Lamotrigine',
      adjustWhenLate: true,
      guardrails: { maxSingleDose: 100, maxDailyDose: null, minIntervalHours: null },
    });
    const next = med({
      ...prev,
      name: 'Lamotrigine XR',
      adjustWhenLate: false,
      guardrails: { maxSingleDose: 200, maxDailyDose: null, minIntervalHours: null },
    });
    const changes = diffMedication(prev, next);
    expect(changes).toContainEqual(
      expect.objectContaining({ field: 'Name', from: 'Lamotrigine', to: 'Lamotrigine XR' }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ field: 'Timing', from: 'timing-sensitive', to: 'flexible' }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ field: 'Max single dose', from: '100', to: '200' }),
    );
  });

  it('represents a newly set / cleared guardrail with null', () => {
    const prev = med({
      guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
    });
    const next = med({
      ...prev,
      guardrails: { maxSingleDose: 150, maxDailyDose: null, minIntervalHours: null },
    });
    expect(diffMedication(prev, next)).toContainEqual(
      expect.objectContaining({ field: 'Max single dose', from: null, to: '150' }),
    );
  });

  // G4 — a change's identity must not be a human label. A copy edit to `field`
  // must be invisible to anything reading the data, and the values must be typed.
  describe('G4 — stable keys and typed values, not display strings', () => {
    it('carries a stable key, the medId, and typed values for every field', () => {
      const prev = med({
        id: 'a',
        name: 'Lamotrigine',
        halfLifeHours: 29,
        adjustWhenLate: true,
        guardrails: { maxSingleDose: 100, maxDailyDose: null, minIntervalHours: null },
      });
      const next = med({
        ...prev,
        name: 'Lamotrigine XR',
        halfLifeHours: 35,
        adjustWhenLate: false,
        guardrails: { maxSingleDose: 200, maxDailyDose: null, minIntervalHours: null },
      });
      const byKey = new Map(diffMedication(prev, next).map((c) => [c.key, c]));

      expect(byKey.get('med.name')).toMatchObject({
        medId: 'a',
        fromValue: 'Lamotrigine',
        toValue: 'Lamotrigine XR',
      });
      // A number stays a number, not "35".
      expect(byKey.get('med.halfLifeHours')).toMatchObject({ fromValue: 29, toValue: 35 });
      // A boolean stays a boolean, not "timing-sensitive".
      expect(byKey.get('med.adjustWhenLate')).toMatchObject({ fromValue: true, toValue: false });
      expect(byKey.get('med.guardrails.maxSingleDose')).toMatchObject({
        fromValue: 100,
        toValue: 200,
      });
      // Display strings are still present for rendering.
      expect(byKey.get('med.adjustWhenLate')!.to).toBe('flexible');
    });

    it('records a cleared guardrail as a typed null, distinct from the string "null"', () => {
      const prev = med({
        id: 'a',
        guardrails: { maxSingleDose: 200, maxDailyDose: null, minIntervalHours: null },
      });
      const next = med({
        ...prev,
        guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
      });
      const change = diffMedication(prev, next).find(
        (c) => c.key === 'med.guardrails.maxSingleDose',
      );
      expect(change).toMatchObject({ fromValue: 200, toValue: null, to: null });
    });

    it('every derived change is structured', () => {
      const prev = med({ id: 'a', name: 'A' });
      const next = med({ ...prev, name: 'B' });
      expect(diffMedication(prev, next).every(isStructuredFieldChange)).toBe(true);
    });
  });
});

describe('diffSlot', () => {
  const meds = new Map<string, Medication>([
    ['a', med({ id: 'a', name: 'Lamotrigine', unit: 'mg' })],
    ['b', med({ id: 'b', name: 'Vitamin D', unit: 'IU' })],
  ]);

  it('reports a per-medication dose change formatted with the unit', () => {
    const prev = slot({ id: 's1', time: '08:00', items: [{ medId: 'a', dose: 100 }] });
    const next = slot({ ...prev, items: [{ medId: 'a', dose: 150 }] });
    expect(diffSlot(prev, next, meds)).toEqual([
      {
        field: 'Lamotrigine dose',
        from: '100mg',
        to: '150mg',
        key: 'slot.dose',
        medId: 'a',
        slotId: 's1',
        fromValue: 100,
        toValue: 150,
      },
    ]);
  });

  it('reports time changes and added/removed items', () => {
    const prev = slot({ id: 's1', time: '08:00', items: [{ medId: 'a', dose: 100 }] });
    const next = slot({ ...prev, time: '09:00', items: [{ medId: 'b', dose: 1000 }] });
    const changes = diffSlot(prev, next, meds);
    expect(changes).toContainEqual(
      expect.objectContaining({ field: 'Time', from: '08:00', to: '09:00', key: 'slot.time' }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ field: 'Lamotrigine dose', from: '100mg', to: null, medId: 'a' }),
    ); // removed
    expect(changes).toContainEqual(
      expect.objectContaining({ field: 'Vitamin D dose', from: null, to: '1000IU', medId: 'b' }),
    ); // added
  });

  it('returns no changes for an identical slot', () => {
    const s = slot({ id: 's1', time: '08:00', items: [{ medId: 'a', dose: 100 }] });
    expect(diffSlot(s, { ...s }, meds)).toEqual([]);
  });

  // G1 — the change used to be keyed by a display *name*.
  describe('G1 — slot dose changes carry the medId', () => {
    it('disambiguates two medications that share a display name', () => {
      const duplicates = new Map<string, Medication>([
        ['a', med({ id: 'a', name: 'Lamotrigine', unit: 'mg' })],
        ['b', med({ id: 'b', name: 'Lamotrigine', unit: 'mg' })],
      ]);
      const prev = slot({
        id: 's1',
        time: '08:00',
        items: [
          { medId: 'a', dose: 100 },
          { medId: 'b', dose: 50 },
        ],
      });
      const next = slot({
        ...prev,
        items: [
          { medId: 'a', dose: 150 },
          { medId: 'b', dose: 50 },
        ],
      });
      const changes = diffSlot(prev, next, duplicates);
      expect(changes).toHaveLength(1);
      // The label alone cannot tell the two apart — the medId can.
      expect(changes[0]!.field).toBe('Lamotrigine dose');
      expect(changes[0]!.medId).toBe('a');
    });

    it('stays resolvable after the medication is renamed', () => {
      const prev = slot({ id: 's1', time: '08:00', items: [{ medId: 'a', dose: 100 }] });
      const next = slot({ ...prev, items: [{ medId: 'a', dose: 150 }] });
      const change = diffSlot(prev, next, meds)[0]!;
      // Later, the medication is renamed. The stored label is now stale, but the
      // identity is not: the change still points at the right medication.
      const renamed = med({ id: 'a', name: 'Lamotrigine XR', unit: 'mg' });
      expect(change.field).toBe('Lamotrigine dose'); // frozen display, as recorded
      expect(change.medId).toBe(renamed.id);
    });

    it('keeps identity when the medication is unknown at diff time', () => {
      const prev = slot({ id: 's1', time: '08:00', items: [{ medId: 'gone', dose: 100 }] });
      const next = slot({ ...prev, items: [{ medId: 'gone', dose: 150 }] });
      const change = diffSlot(prev, next, new Map())[0]!;
      expect(change.medId).toBe('gone');
      expect(change.fromValue).toBe(100);
      expect(change.toValue).toBe(150);
    });

    it('attributes time and label changes to the slot', () => {
      const prev = slot({ id: 's1', time: '08:00', label: 'Morning', items: [] });
      const next = slot({ ...prev, time: '09:00', label: 'Late morning' });
      const changes = diffSlot(prev, next, meds);
      expect(changes.map((c) => c.key)).toEqual(['slot.time', 'slot.label']);
      expect(changes.every((c) => c.slotId === 's1')).toBe(true);
    });
  });
});

describe('buildRegimenChange', () => {
  const now = Date.UTC(2026, 5, 12, 9, 0);

  it('composes a single-change summary as "subject: field from → to"', () => {
    const change = buildRegimenChange({
      kind: 'slot-updated',
      subject: 'Morning',
      slotId: 's1',
      changes: [{ field: 'Lamotrigine dose', from: '100mg', to: '150mg' }],
      now,
      zone: ZONE,
    });
    expect(change.summary).toBe('Morning: Lamotrigine dose 100mg → 150mg');
    expect(change.slotId).toBe('s1');
    expect(change.medId).toBeUndefined();
    expect(change.changedAt).toBe(now);
    expect(change.updatedAt).toBe(now);
  });

  it('summarises additions and multi-change updates concisely', () => {
    expect(
      buildRegimenChange({
        kind: 'medication-added',
        subject: 'Lamotrigine',
        changes: [],
        now,
        zone: ZONE,
      }).summary,
    ).toBe('Added Lamotrigine');
    expect(
      buildRegimenChange({
        kind: 'medication-updated',
        subject: 'Lamotrigine',
        changes: [
          { field: 'Name', from: 'A', to: 'B' },
          { field: 'Unit', from: 'mg', to: 'g' },
        ],
        now,
        zone: ZONE,
      }).summary,
    ).toBe('Lamotrigine: 2 changes');
  });

  it('summarises a reactivation as "Resumed", distinct from "Added"', () => {
    expect(
      buildRegimenChange({
        kind: 'medication-reactivated',
        subject: 'Lamotrigine',
        changes: [],
        now,
        zone: ZONE,
      }).summary,
    ).toBe('Resumed Lamotrigine');
  });
});

describe('groupChangesByDay', () => {
  const at = (h: number) => Date.UTC(2026, 5, 12, h, 0);
  function change(over: Partial<RegimenChange>): RegimenChange {
    return {
      id: over.id ?? 'c',
      changedAt: over.changedAt ?? at(9),
      zone: ZONE,
      kind: 'slot-updated',
      summary: 's',
      changes: [],
      updatedAt: over.changedAt ?? at(9),
      ...over,
    };
  }

  it('groups same-day changes into one bucket, sorted by time', () => {
    const a = change({ id: 'a', changedAt: at(20) });
    const b = change({ id: 'b', changedAt: at(8) });
    const groups = groupChangesByDay([a, b], ZONE);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.date).toBe('2026-06-12');
    expect(groups[0]!.changes.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('separates different days and sorts groups ascending', () => {
    const d12 = change({ id: 'x', changedAt: Date.UTC(2026, 5, 12, 9, 0) });
    const d10 = change({ id: 'y', changedAt: Date.UTC(2026, 5, 10, 9, 0) });
    const groups = groupChangesByDay([d12, d10], ZONE);
    expect(groups.map((g) => g.date)).toEqual(['2026-06-10', '2026-06-12']);
  });

  it('excludes soft-deleted changes', () => {
    const live = change({ id: 'live' });
    const gone = change({ id: 'gone', deleted: true });
    const groups = groupChangesByDay([live, gone], ZONE);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.changes.map((c) => c.id)).toEqual(['live']);
  });

  it('groups a legacy (display-only) change alongside a structured one', () => {
    const legacy = change({
      id: 'legacy',
      changedAt: at(8),
      changes: [{ field: 'Lamotrigine dose', from: '100mg', to: '150mg' }],
    });
    const modern = change({
      id: 'modern',
      changedAt: at(9),
      changes: [
        {
          field: 'Lamotrigine dose',
          from: '150mg',
          to: '200mg',
          key: 'slot.dose',
          medId: 'a',
          slotId: 's1',
          fromValue: 150,
          toValue: 200,
        },
      ],
    });
    const groups = groupChangesByDay([modern, legacy], ZONE);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.changes.map((c) => c.id)).toEqual(['legacy', 'modern']);
  });
});

describe('isStructuredFieldChange', () => {
  it('rejects a pre-Stage-18 record rather than inventing structure for it', () => {
    const legacy: RegimenFieldChange = {
      field: 'Lamotrigine dose',
      from: '100mg',
      to: '150mg',
    };
    expect(isStructuredFieldChange(legacy)).toBe(false);
  });

  it('accepts a change carrying key + both typed values, even when both are null', () => {
    const structured: RegimenFieldChange = {
      field: 'Notes',
      from: null,
      to: null,
      key: 'med.notes',
      fromValue: null,
      toValue: null,
    };
    expect(isStructuredFieldChange(structured)).toBe(true);
  });

  it('rejects a partially structured change (key without typed values)', () => {
    const partial: RegimenFieldChange = {
      field: 'Notes',
      from: null,
      to: 'x',
      key: 'med.notes',
    };
    expect(isStructuredFieldChange(partial)).toBe(false);
  });
});

describe('describeMedicationAdded / Retired / Reactivated', () => {
  it('lists a new medication as null → value additions, skipping empty fields', () => {
    const m = med({ id: 'a', name: 'Lamotrigine', unit: 'mg', halfLifeHours: 29 });
    const changes = describeMedicationAdded(m);
    expect(changes).toContainEqual(
      expect.objectContaining({ field: 'Name', from: null, to: 'Lamotrigine' }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ field: 'Unit', from: null, to: 'mg' }),
    );
    expect(changes.every((c) => c.from === null)).toBe(true);
    // No notes set → no Notes row (display is null, filtered out).
    expect(changes.some((c) => c.field === 'Notes')).toBe(false);
    // Every row is attributed to the medication and typed.
    expect(changes.every((c) => c.medId === 'a')).toBe(true);
    expect(changes.find((c) => c.key === 'med.halfLifeHours')!.toValue).toBe(29);
  });

  it('marks a retirement as Active → Retired with a typed status flip', () => {
    const m = med({ id: 'a' });
    expect(describeMedicationRetired(m)).toEqual([
      {
        field: 'Status',
        from: 'Active',
        to: 'Retired',
        key: 'med.active',
        medId: 'a',
        fromValue: true,
        toValue: false,
      },
    ]);
  });

  // G3 — create and reactivate used to be the same kind with the same diff.
  it('G3 — describes a reactivation as the inverse status flip, not a fresh prescription', () => {
    const m = med({ id: 'a', name: 'Lamotrigine' });
    const changes = describeMedicationReactivated(m);
    expect(changes).toEqual([
      {
        field: 'Status',
        from: 'Retired',
        to: 'Active',
        key: 'med.active',
        medId: 'a',
        fromValue: false,
        toValue: true,
      },
    ]);
    // Distinguishable from a first prescription, which restates every field.
    expect(changes).not.toEqual(describeMedicationAdded(m));
  });
});

// G2 — a hard delete strips the medication from every slot; those doses used to
// be recorded nowhere.
describe('describeMedicationSlotCascade (G2)', () => {
  const lamotrigine = med({ id: 'a', name: 'Lamotrigine', unit: 'mg' });

  it('records the dose removed from each affected slot, with slot and med identity', () => {
    const morning = slot({ id: 's1', time: '08:00', label: 'Morning', items: [] });
    const evening = slot({ id: 's2', time: '20:00', items: [] });
    const changes = describeMedicationSlotCascade(lamotrigine, [
      { slot: evening, dose: 200, slotRemoved: false },
      { slot: morning, dose: 150, slotRemoved: false },
    ]);
    // Sorted by slot time for deterministic, readable output.
    expect(changes).toEqual([
      {
        field: '08:00 Morning: Lamotrigine dose',
        from: '150mg',
        to: null,
        key: 'slot.dose',
        medId: 'a',
        slotId: 's1',
        fromValue: 150,
        toValue: null,
      },
      {
        field: '20:00: Lamotrigine dose',
        from: '200mg',
        to: null,
        key: 'slot.dose',
        medId: 'a',
        slotId: 's2',
        fromValue: 200,
        toValue: null,
      },
    ]);
  });

  it('also records the slot itself when it was left empty and tombstoned', () => {
    const only = slot({ id: 's1', time: '08:00', label: 'Morning', items: [] });
    const changes = describeMedicationSlotCascade(lamotrigine, [
      { slot: only, dose: 150, slotRemoved: true },
    ]);
    expect(changes).toHaveLength(2);
    expect(changes[1]).toEqual({
      field: '08:00 Morning: slot',
      from: '08:00 Morning',
      to: null,
      key: 'slot.removed',
      slotId: 's1',
      fromValue: '08:00',
      toValue: null,
    });
  });

  it('produces nothing when the medication was in no slot', () => {
    expect(describeMedicationSlotCascade(lamotrigine, [])).toEqual([]);
  });
});

describe('describeSlot / slotSubject', () => {
  const meds = new Map<string, Medication>([
    ['a', med({ id: 'a', name: 'Lamotrigine', unit: 'mg' })],
  ]);

  it('describes an added slot as null → value for time and each dose', () => {
    const s = slot({
      id: 's1',
      time: '20:00',
      label: 'Evening',
      items: [{ medId: 'a', dose: 150 }],
    });
    expect(describeSlot(s, meds, 'added')).toEqual([
      {
        field: 'Time',
        from: null,
        to: '20:00',
        key: 'slot.time',
        slotId: 's1',
        fromValue: null,
        toValue: '20:00',
      },
      {
        field: 'Label',
        from: null,
        to: 'Evening',
        key: 'slot.label',
        slotId: 's1',
        fromValue: null,
        toValue: 'Evening',
      },
      {
        field: 'Lamotrigine dose',
        from: null,
        to: '150mg',
        key: 'slot.dose',
        medId: 'a',
        slotId: 's1',
        fromValue: null,
        toValue: 150,
      },
    ]);
  });

  it('describes a removed slot with value → null', () => {
    const s = slot({ id: 's1', time: '20:00', items: [{ medId: 'a', dose: 150 }] });
    expect(describeSlot(s, meds, 'removed')).toEqual([
      {
        field: 'Time',
        from: '20:00',
        to: null,
        key: 'slot.time',
        slotId: 's1',
        fromValue: '20:00',
        toValue: null,
      },
      {
        field: 'Lamotrigine dose',
        from: '150mg',
        to: null,
        key: 'slot.dose',
        medId: 'a',
        slotId: 's1',
        fromValue: 150,
        toValue: null,
      },
    ]);
  });

  it('builds a readable subject from time and label', () => {
    expect(slotSubject(slot({ time: '20:00', label: 'Evening' }))).toBe('20:00 Evening');
    expect(slotSubject(slot({ time: '08:00' }))).toBe('08:00');
  });
});

describe('formatDose', () => {
  it('joins amount and unit', () => {
    expect(formatDose(150, 'mg')).toBe('150mg');
  });
});
