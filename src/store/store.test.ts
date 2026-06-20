import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { LocalRepository, SteadyDoseDB } from './localRepository';
import { setRepository, nullRepository } from './repository';

let dbName: string;
let db: SteadyDoseDB;
let counter = 0;

function resetStore() {
  useStore.setState({
    hydrated: false,
    medications: [],
    slots: [],
    doseLog: [],
    doseOverrides: [],
    eventTypes: [],
    eventInstances: [],
    regimenChanges: [],
    settings: {
      zone: 'Europe/London',
      adherenceWindowDays: 7,
      missedDayThreshold: 3,
      updatedAt: 0,
    },
  });
}

const MED_INPUT = {
  name: 'Test',
  color: '#fff',
  unit: 'mg',
  halfLifeHours: 10,
  adjustWhenLate: true,
  active: true,
  guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
} as const;

/** Non-deleted changes in the store, for the Stage 16 emission assertions. */
function liveChanges() {
  return useStore.getState().regimenChanges.filter((c) => !c.deleted);
}

beforeEach(() => {
  dbName = `steadydose-store-${++counter}-${Date.now()}`;
  db = new SteadyDoseDB(dbName);
  setRepository(new LocalRepository(db));
  resetStore();
});

afterEach(async () => {
  setRepository(nullRepository);
  db.close();
  await SteadyDoseDB.delete(dbName);
});

describe('store + LocalRepository', () => {
  it('seeds sample data on first run and marks hydrated (FR-2.3)', async () => {
    await useStore.getState().hydrate();
    const s = useStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.medications.length).toBeGreaterThan(0);
    expect(s.slots.length).toBeGreaterThan(0);
  });

  it('editing a record advances updatedAt and increments version (AC3)', async () => {
    await useStore.getState().hydrate();
    const created = useStore.getState().addMedication({
      name: 'Test',
      color: '#fff',
      unit: 'mg',
      halfLifeHours: 10,
      adjustWhenLate: true,
      active: true,
      guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
    });
    expect(created.version).toBe(1);

    useStore.getState().updateMedication(created.id, { name: 'Renamed' });
    const updated = useStore.getState().medications.find((m) => m.id === created.id)!;
    expect(updated.name).toBe('Renamed');
    expect(updated.version).toBe(2);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('deleting a record leaves a tombstone in the store (AC4)', async () => {
    await useStore.getState().hydrate();
    const created = useStore.getState().addMedication({
      name: 'ToDelete',
      color: '#fff',
      unit: 'mg',
      halfLifeHours: 10,
      adjustWhenLate: true,
      active: true,
      guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
    });
    useStore.getState().deleteMedication(created.id);
    const rec = useStore.getState().medications.find((m) => m.id === created.id);
    expect(rec?.deleted).toBe(true);
  });

  it('persists across a reload from IndexedDB (AC1)', async () => {
    await useStore.getState().hydrate();
    useStore.getState().addMedication({
      name: 'Persisted',
      color: '#fff',
      unit: 'mg',
      halfLifeHours: 10,
      adjustWhenLate: true,
      active: true,
      guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
    });
    // Flush async write-through.
    await new Promise((r) => setTimeout(r, 50));

    // Simulate a reload: reset in-memory store, attach a fresh repo on same DB.
    db.close();
    const db2 = new SteadyDoseDB(dbName);
    setRepository(new LocalRepository(db2));
    resetStore();
    await useStore.getState().hydrate();

    const names = useStore.getState().medications.map((m) => m.name);
    expect(names).toContain('Persisted');
    db2.close();
  });

  it('sets a one-time next-dose override and consumes it when the dose is logged (Stage 12)', async () => {
    await useStore.getState().hydrate();
    const scheduledInstant = Date.UTC(2026, 5, 18, 19, 0); // 20:00 BST

    const ovr = useStore.getState().setDoseOverride({
      slotId: 's-evening',
      medId: 'm1',
      scheduledInstant,
      dose: 75,
    });
    expect(useStore.getState().doseOverrides.find((o) => o.id === ovr.id)?.deleted).toBeFalsy();

    // Re-setting the same occurrence updates in place rather than stacking.
    const ovr2 = useStore.getState().setDoseOverride({
      slotId: 's-evening',
      medId: 'm1',
      scheduledInstant,
      dose: 80,
    });
    expect(ovr2.id).toBe(ovr.id);
    expect(useStore.getState().doseOverrides.filter((o) => !o.deleted)).toHaveLength(1);

    // Logging that occurrence consumes (tombstones) the override.
    useStore.getState().logDose({
      slotId: 's-evening',
      medId: 'm1',
      scheduledInstant,
      dose: 80,
      actualInstant: scheduledInstant,
    });
    expect(useStore.getState().doseOverrides.filter((o) => !o.deleted)).toHaveLength(0);
  });

  it('re-times a logged dose, keeping the amount and refreshing warnings (Stage 13)', async () => {
    await useStore.getState().hydrate();
    useStore.setState({
      medications: [
        {
          id: 'm1',
          name: 'Med',
          color: '#fff',
          unit: 'mg',
          halfLifeHours: 10,
          adjustWhenLate: true,
          active: true,
          guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: 6 },
          updatedAt: 0,
        },
      ],
      slots: [],
      doseLog: [],
    });
    const scheduledInstant = Date.UTC(2026, 5, 18, 7, 0); // 08:00 BST
    // A prior dose 3h earlier so the min-interval (6h) guardrail can trip.
    useStore.getState().logDose({
      slotId: 's1',
      medId: 'm1',
      scheduledInstant: scheduledInstant - 4 * 3_600_000,
      dose: 100,
      actualInstant: scheduledInstant - 4 * 3_600_000,
    });
    const entry = useStore.getState().logDose({
      slotId: 's1',
      medId: 'm1',
      scheduledInstant,
      dose: 100,
      actualInstant: scheduledInstant + 8 * 3_600_000, // far from the prior dose → no warning
    });
    expect(entry.warnings).toHaveLength(0);

    // Drag it back to just 1h after the prior dose → below the 6h interval.
    const updated = useStore.getState().adjustDoseTime(entry.id, scheduledInstant - 3 * 3_600_000);
    expect(updated?.actualInstant).toBe(scheduledInstant - 3 * 3_600_000);
    expect(updated?.dose).toBe(100); // amount untouched — never originated
    expect(updated?.warnings.some((w) => /interval/i.test(w))).toBe(true);
    expect(updated?.version).toBe((entry.version ?? 0) + 1);
  });

  it('defines an event type, logs an instance, and persists both (Stage 15)', async () => {
    await useStore.getState().hydrate();
    const type = useStore.getState().addEventType({
      name: 'Migraine',
      color: '#9333ea',
      properties: [{ id: 'severity', name: 'Severity', type: 'scale', min: 1, max: 5 }],
    });
    expect(type.version).toBe(1);

    const occurredAt = Date.UTC(2026, 5, 18, 14, 30);
    const inst = useStore.getState().logEvent({
      typeId: type.id,
      occurredAt,
      values: { severity: 4 },
      note: 'after lunch',
    });
    expect(inst.zone).toBeTruthy();
    expect(inst.values.severity).toBe(4);

    // Flush async write-through, then reload from a fresh repo on the same DB.
    await new Promise((r) => setTimeout(r, 50));
    db.close();
    const db2 = new SteadyDoseDB(dbName);
    setRepository(new LocalRepository(db2));
    resetStore();
    await useStore.getState().hydrate();

    expect(useStore.getState().eventTypes.find((t) => t.id === type.id)?.name).toBe('Migraine');
    expect(useStore.getState().eventInstances.find((e) => e.id === inst.id)?.values.severity).toBe(
      4,
    );
    db2.close();
  });

  it('archives an event type (reversibly) without deleting it or its instances (Stage 15)', async () => {
    await useStore.getState().hydrate();
    const type = useStore.getState().addEventType({
      name: 'Seizure',
      color: '#9333ea',
      properties: [],
    });
    const inst = useStore
      .getState()
      .logEvent({ typeId: type.id, occurredAt: Date.now(), values: {} });

    useStore.getState().setEventTypeArchived(type.id, true);
    const archived = useStore.getState().eventTypes.find((t) => t.id === type.id);
    expect(archived?.archived).toBe(true);
    expect(archived?.deleted).toBeFalsy(); // archived, never tombstoned
    // The instance survives (history is preserved).
    expect(useStore.getState().eventInstances.find((e) => e.id === inst.id)?.deleted).toBeFalsy();

    // Archiving is reversible.
    useStore.getState().setEventTypeArchived(type.id, false);
    expect(useStore.getState().eventTypes.find((t) => t.id === type.id)?.archived).toBe(false);
  });

  it('emits one regimen change per meaningful edit and none for a no-op (Stage 16 AC1)', async () => {
    await useStore.getState().hydrate();
    // Start from a clean slate so the seed change does not skew counts.
    useStore.setState({ medications: [], slots: [], regimenChanges: [] });

    const med = useStore.getState().addMedication(MED_INPUT);
    expect(liveChanges().map((c) => c.kind)).toEqual(['medication-added']);

    // A real prescription edit records a medication-updated change.
    useStore.getState().updateMedication(med.id, { name: 'Renamed' });
    expect(liveChanges().map((c) => c.kind)).toEqual(['medication-added', 'medication-updated']);
    const updated = liveChanges().at(-1)!;
    expect(updated.summary).toContain('Renamed');
    expect(updated.changes).toContainEqual({ field: 'Name', from: 'Test', to: 'Renamed' });

    // A no-op save (same name) records nothing further.
    useStore.getState().updateMedication(med.id, { name: 'Renamed' });
    expect(liveChanges()).toHaveLength(2);

    // Retiring the medication records a medication-retired change.
    useStore.getState().deleteMedication(med.id);
    expect(liveChanges().at(-1)!.kind).toBe('medication-retired');
  });

  it('emits slot-added / slot-updated / slot-removed for schedule edits (Stage 16 AC2)', async () => {
    await useStore.getState().hydrate();
    const med = useStore.getState().addMedication(MED_INPUT);
    useStore.setState({ slots: [], regimenChanges: [] });

    const slot = useStore
      .getState()
      .addSlot({ time: '20:00', label: 'Evening', items: [{ medId: med.id, dose: 100 }] });
    expect(liveChanges().at(-1)!.kind).toBe('slot-added');
    expect(liveChanges().at(-1)!.slotId).toBe(slot.id);

    // Raise the dose 100 → 150: one slot-updated whose diff reads "100mg → 150mg".
    useStore.getState().updateSlot(slot.id, { items: [{ medId: med.id, dose: 150 }] });
    const updated = liveChanges().at(-1)!;
    expect(updated.kind).toBe('slot-updated');
    expect(updated.changes).toContainEqual({ field: 'Test dose', from: '100mg', to: '150mg' });

    useStore.getState().deleteSlot(slot.id);
    expect(liveChanges().at(-1)!.kind).toBe('slot-removed');
  });

  it('annotates and soft-deletes a regimen change (Stage 16 AC6)', async () => {
    await useStore.getState().hydrate();
    const med = useStore.getState().addMedication(MED_INPUT);
    const change = useStore.getState().regimenChanges.at(-1)!;

    useStore.getState().addChangeNote(change.id, 'GP-approved');
    const annotated = useStore.getState().regimenChanges.find((c) => c.id === change.id)!;
    expect(annotated.note).toBe('GP-approved');
    expect(annotated.changedAt).toBe(change.changedAt); // event time stays put
    expect(annotated.version).toBe((change.version ?? 0) + 1);

    useStore.getState().deleteChange(change.id);
    expect(useStore.getState().regimenChanges.find((c) => c.id === change.id)?.deleted).toBe(true);
    void med;
  });

  it('does not re-seed when data already exists', async () => {
    await useStore.getState().hydrate();
    const firstCount = useStore.getState().medications.length;
    // Flush writes, then reload.
    await new Promise((r) => setTimeout(r, 50));
    db.close();
    const db2 = new SteadyDoseDB(dbName);
    setRepository(new LocalRepository(db2));
    resetStore();
    await useStore.getState().hydrate();
    expect(useStore.getState().medications.length).toBe(firstCount);
    db2.close();
  });
});
