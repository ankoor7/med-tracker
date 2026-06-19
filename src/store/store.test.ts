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
    settings: {
      zone: 'Europe/London',
      adherenceWindowDays: 7,
      missedDayThreshold: 3,
      updatedAt: 0,
    },
  });
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

  it('defines an event type, logs an instance, and persists both (Stage 13)', async () => {
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

  it('tombstones an event type without deleting its instances (Stage 13)', async () => {
    await useStore.getState().hydrate();
    const type = useStore.getState().addEventType({
      name: 'Seizure',
      color: '#9333ea',
      properties: [],
    });
    const inst = useStore
      .getState()
      .logEvent({ typeId: type.id, occurredAt: Date.now(), values: {} });

    useStore.getState().deleteEventType(type.id);
    expect(useStore.getState().eventTypes.find((t) => t.id === type.id)?.deleted).toBe(true);
    // The instance survives (history is preserved).
    expect(useStore.getState().eventInstances.find((e) => e.id === inst.id)?.deleted).toBeFalsy();
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
