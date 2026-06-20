import { describe, expect, it } from 'vitest';
import {
  buildRegimenChange,
  describeMedicationAdded,
  describeMedicationRetired,
  describeSlot,
  diffMedication,
  diffSlot,
  formatDose,
  groupChangesByDay,
  slotSubject,
} from './regimenChanges';
import type { Medication, RegimenChange } from './types';
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
    expect(changes).toContainEqual({ field: 'Name', from: 'Lamotrigine', to: 'Lamotrigine XR' });
    expect(changes).toContainEqual({ field: 'Timing', from: 'timing-sensitive', to: 'flexible' });
    expect(changes).toContainEqual({ field: 'Max single dose', from: '100', to: '200' });
  });

  it('represents a newly set / cleared guardrail with null', () => {
    const prev = med({
      guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
    });
    const next = med({
      ...prev,
      guardrails: { maxSingleDose: 150, maxDailyDose: null, minIntervalHours: null },
    });
    expect(diffMedication(prev, next)).toContainEqual({
      field: 'Max single dose',
      from: null,
      to: '150',
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
      { field: 'Lamotrigine dose', from: '100mg', to: '150mg' },
    ]);
  });

  it('reports time changes and added/removed items', () => {
    const prev = slot({ id: 's1', time: '08:00', items: [{ medId: 'a', dose: 100 }] });
    const next = slot({ ...prev, time: '09:00', items: [{ medId: 'b', dose: 1000 }] });
    const changes = diffSlot(prev, next, meds);
    expect(changes).toContainEqual({ field: 'Time', from: '08:00', to: '09:00' });
    expect(changes).toContainEqual({ field: 'Lamotrigine dose', from: '100mg', to: null }); // removed
    expect(changes).toContainEqual({ field: 'Vitamin D dose', from: null, to: '1000IU' }); // added
  });

  it('returns no changes for an identical slot', () => {
    const s = slot({ id: 's1', time: '08:00', items: [{ medId: 'a', dose: 100 }] });
    expect(diffSlot(s, { ...s }, meds)).toEqual([]);
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
});

describe('describeMedicationAdded / Retired', () => {
  it('lists a new medication as null → value additions, skipping empty fields', () => {
    const m = med({ id: 'a', name: 'Lamotrigine', unit: 'mg', halfLifeHours: 29 });
    const changes = describeMedicationAdded(m);
    expect(changes).toContainEqual({ field: 'Name', from: null, to: 'Lamotrigine' });
    expect(changes).toContainEqual({ field: 'Unit', from: null, to: 'mg' });
    expect(changes.every((c) => c.from === null)).toBe(true);
    // No notes set → no Notes row (display is null, filtered out).
    expect(changes.some((c) => c.field === 'Notes')).toBe(false);
  });

  it('marks a retirement as Active → Retired', () => {
    expect(describeMedicationRetired()).toEqual([
      { field: 'Status', from: 'Active', to: 'Retired' },
    ]);
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
      { field: 'Time', from: null, to: '20:00' },
      { field: 'Label', from: null, to: 'Evening' },
      { field: 'Lamotrigine dose', from: null, to: '150mg' },
    ]);
  });

  it('describes a removed slot with value → null', () => {
    const s = slot({ id: 's1', time: '20:00', items: [{ medId: 'a', dose: 150 }] });
    expect(describeSlot(s, meds, 'removed')).toEqual([
      { field: 'Time', from: '20:00', to: null },
      { field: 'Lamotrigine dose', from: '150mg', to: null },
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
