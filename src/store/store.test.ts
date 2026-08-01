import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore, type EventInstanceInput } from './store';
import { LocalRepository, SteadyDoseDB } from './localRepository';
import { setRepository, nullRepository } from './repository';
import { isoDateInZone, resolveScheduleAsOf, resolveWallTimeToInstant } from '../core';
import type { Guardrails } from '../core/types';

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
    scheduleSnapshots: [],
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

/** Snapshots in the store, oldest first, for the Stage 18 assertions. */
function snapshots() {
  return [...useStore.getState().scheduleSnapshots].sort(
    (a, b) => a.effectiveFrom - b.effectiveFrom,
  );
}

/** Non-deleted changes in the store, for the Stage 16 emission assertions. */
function liveChanges() {
  return useStore.getState().regimenChanges.filter((c) => !c.deleted);
}

/**
 * Simulate a reload: flush the async write-through, close the current DB
 * connection, then hydrate a fresh store against a new repository on the same
 * IndexedDB database — proving a mutation was actually persisted (and would
 * therefore sync), not just held in memory.
 */
async function reloadFromFreshRepo() {
  await new Promise((r) => setTimeout(r, 50));
  db.close();
  db = new SteadyDoseDB(dbName);
  setRepository(new LocalRepository(db));
  resetStore();
  await useStore.getState().hydrate();
}

/**
 * Hydrate, then clear medications/slots/changes so the seeded demo dataset does
 * not skew emission counts. Returns a freshly added medication to edit.
 */
async function freshRegimen() {
  await useStore.getState().hydrate();
  useStore.setState({ medications: [], slots: [], regimenChanges: [] });
  return useStore.getState().addMedication(MED_INPUT);
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
    await reloadFromFreshRepo();

    const names = useStore.getState().medications.map((m) => m.name);
    expect(names).toContain('Persisted');
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

  /**
   * Hydrate an empty regimen and log one bare dose entry (no real slot/med —
   * these tests only care about the log entry's own lifecycle), for the
   * editLogEntry/deleteLogEntry correction-path tests below.
   */
  async function logBareEntry() {
    await useStore.getState().hydrate();
    useStore.setState({ medications: [], slots: [], doseLog: [] });
    return useStore.getState().logDose({
      slotId: 's1',
      medId: 'm1',
      scheduledInstant: 0,
      dose: 100,
      actualInstant: 0,
    });
  }

  /**
   * Hydrate a regimen with one medication ('m1') in one slot ('s1'), with
   * `guardrails` overriding the (otherwise unset) defaults — shared by the
   * editLogEntry/skipDose tests below that need a real med+slot to log or
   * skip against (unlike `logBareEntry`'s empty regimen).
   */
  async function seedMedSlot(guardrails: Partial<Guardrails> = {}) {
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
          guardrails: {
            maxSingleDose: null,
            maxDailyDose: null,
            minIntervalHours: null,
            ...guardrails,
          },
          updatedAt: 0,
        },
      ],
      slots: [{ id: 's1', time: '08:00', items: [{ medId: 'm1', dose: 100 }], updatedAt: 0 }],
      doseLog: [],
    });
  }

  /** Hydrate an empty regimen and skip one bare occurrence at instant 0. */
  async function skipBareEntry(reason?: string) {
    await useStore.getState().hydrate();
    useStore.setState({ medications: [], slots: [], doseLog: [] });
    return useStore.getState().skipDose({
      slotId: 's1',
      medId: 'm1',
      scheduledInstant: 0,
      actualInstant: 0,
      ...(reason ? { reason } : {}),
    });
  }

  describe('editLogEntry (Stage 18 FR-18.2 — dose correction)', () => {
    it('corrects both dose and time, re-running guardrails excluding itself (AC5)', async () => {
      await seedMedSlot({ maxSingleDose: 100 });
      const scheduledInstant = Date.UTC(2026, 5, 18, 7, 0);
      const entry = useStore.getState().logDose({
        slotId: 's1',
        medId: 'm1',
        scheduledInstant,
        dose: 100,
        actualInstant: scheduledInstant,
      });
      expect(entry.warnings).toHaveLength(0);

      // Correct both the amount and the time in one edit.
      const updated = useStore
        .getState()
        .editLogEntry(entry.id, { dose: 90, actualInstant: scheduledInstant + 3_600_000 });
      expect(updated?.dose).toBe(90);
      expect(updated?.actualInstant).toBe(scheduledInstant + 3_600_000);
      // 90mg differs from the slot's normal 100mg, so it's flagged adjusted.
      expect(updated?.adjusted).toBe(true);
      expect(updated?.version).toBe((entry.version ?? 0) + 1);

      // Guardrail excludes the entry from its own history: editing dose to
      // 100mg (the max) alone must not warn against the pre-edit 100mg copy of
      // itself still sitting in the log.
      const atCap = useStore.getState().editLogEntry(entry.id, { dose: 100 });
      expect(atCap?.warnings).toHaveLength(0);

      // Exceeding the cap does warn, same shared checkGuardrails as logDose.
      const overCap = useStore.getState().editLogEntry(entry.id, { dose: 150 });
      expect(overCap?.warnings.some((w) => /max single dose/i.test(w))).toBe(true);
    });

    it('does not record a Stage 16 RegimenChange — a dose correction, not a regimen change', async () => {
      await useStore.getState().hydrate();
      useStore.setState({ medications: [], slots: [], regimenChanges: [] });
      const med = useStore.getState().addMedication(MED_INPUT);
      useStore.setState({ regimenChanges: [] }); // ignore the medication-added marker
      const scheduledInstant = Date.UTC(2026, 5, 18, 7, 0);
      const entry = useStore.getState().logDose({
        slotId: 'no-slot',
        medId: med.id,
        scheduledInstant,
        dose: 100,
        actualInstant: scheduledInstant,
      });
      useStore
        .getState()
        .editLogEntry(entry.id, { dose: 120, actualInstant: scheduledInstant + 1000 });
      expect(liveChanges()).toHaveLength(0);
    });

    it('returns undefined for a deleted or unknown entry, mutating nothing', async () => {
      const entry = await logBareEntry();
      useStore.getState().deleteLogEntry(entry.id);
      expect(useStore.getState().editLogEntry(entry.id, { dose: 999 })).toBeUndefined();
      expect(useStore.getState().editLogEntry('does-not-exist', { dose: 999 })).toBeUndefined();
      // The tombstoned entry's dose was not resurrected/changed by the no-op edit.
      const stillTombstoned = useStore.getState().doseLog.find((e) => e.id === entry.id)!;
      expect(stillTombstoned.deleted).toBe(true);
      expect(stillTombstoned.dose).toBe(100);
    });
  });

  describe('deleteLogEntry (Stage 18 FR-18.2 — dose correction)', () => {
    it('tombstones rather than hard-deletes, and the tombstone persists/syncs (AC7-style retention)', async () => {
      const entry = await logBareEntry();
      useStore.getState().deleteLogEntry(entry.id);

      const inMemory = useStore.getState().doseLog.find((e) => e.id === entry.id);
      expect(inMemory).toBeDefined();
      expect(inMemory?.deleted).toBe(true);
      // Never hard-deleted: the record is still present, just tombstoned.
      expect(useStore.getState().doseLog).toHaveLength(1);

      // Prove the tombstone was actually persisted (i.e. "syncs"), not just
      // held in memory.
      await reloadFromFreshRepo();
      const reloaded = useStore.getState().doseLog.find((e) => e.id === entry.id);
      expect(reloaded?.deleted).toBe(true);
    });
  });

  describe('skipDose (Stage 18 FR-18.3 — deliberately withheld doses)', () => {
    it('records a skipped entry distinct from taken — no amount, an optional reason', async () => {
      await seedMedSlot();
      const scheduledInstant = Date.UTC(2026, 5, 18, 7, 0);
      const entry = useStore.getState().skipDose({
        slotId: 's1',
        medId: 'm1',
        scheduledInstant,
        actualInstant: scheduledInstant + 3_600_000,
        reason: 'clinician advised skipping',
      });
      expect(entry.status).toBe('skipped');
      expect(entry.dose).toBe(0); // no amount was taken
      expect(entry.warnings).toHaveLength(0);
      expect(entry.skipReason).toBe('clinician advised skipping');
      expect(useStore.getState().doseLog.map((e) => e.id)).toEqual([entry.id]);
    });

    it('omits skipReason entirely when none is given (never a required field)', async () => {
      const entry = await skipBareEntry();
      expect(entry.skipReason).toBeUndefined();
    });

    it('persists, survives reload, and syncs like any other dose-log entry', async () => {
      const entry = await skipBareEntry('felt unwell');
      await reloadFromFreshRepo();
      const reloaded = useStore.getState().doseLog.find((e) => e.id === entry.id);
      expect(reloaded?.status).toBe('skipped');
      expect(reloaded?.skipReason).toBe('felt unwell');
    });

    it('a skipped dose does not corrupt guardrail checks or daily totals', async () => {
      // A tight daily cap: if the skip's dose (0) were ever summed in as if it
      // were a real dose amount, or if a skip could somehow inflate the daily
      // total, this would misbehave.
      await seedMedSlot({ maxDailyDose: 100, minIntervalHours: 4 });
      const morning = Date.UTC(2026, 5, 18, 7, 0);
      useStore.getState().skipDose({
        slotId: 's1',
        medId: 'm1',
        scheduledInstant: morning,
        actualInstant: morning,
      });
      // A full 100mg dose an hour later: the skip contributed nothing to the
      // daily total (still 0 so far) and nothing to the min-interval history
      // (no *taken* dose preceded it), so this logs clean.
      const taken = useStore.getState().logDose({
        slotId: 's1',
        medId: 'm1',
        scheduledInstant: morning + 3_600_000,
        dose: 100,
        actualInstant: morning + 3_600_000,
      });
      expect(taken.warnings).toHaveLength(0);
    });

    it('clears a pending one-time override for the skipped occurrence (Stage 12)', async () => {
      await useStore.getState().hydrate();
      useStore.setState({ medications: [], slots: [], doseLog: [], doseOverrides: [] });
      const scheduledInstant = 10_000_000;
      const ovr = useStore.getState().setDoseOverride({
        slotId: 's1',
        medId: 'm1',
        scheduledInstant,
        dose: 75,
      });
      expect(useStore.getState().doseOverrides.find((o) => o.id === ovr.id)?.deleted).toBeFalsy();

      useStore.getState().skipDose({
        slotId: 's1',
        medId: 'm1',
        scheduledInstant,
        actualInstant: scheduledInstant,
      });
      expect(useStore.getState().doseOverrides.filter((o) => !o.deleted)).toHaveLength(0);
    });

    it('takeGroup does not re-log an item that was already skipped', async () => {
      await seedMedSlot();
      const scheduledInstant = Date.UTC(2026, 5, 18, 7, 0);
      useStore.getState().skipDose({
        slotId: 's1',
        medId: 'm1',
        scheduledInstant,
        actualInstant: scheduledInstant,
      });
      const created = useStore.getState().takeGroup('s1', scheduledInstant);
      expect(created).toHaveLength(0);
      expect(useStore.getState().doseLog.filter((e) => !e.deleted)).toHaveLength(1);
      expect(useStore.getState().doseLog[0]!.status).toBe('skipped');
    });
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

    await reloadFromFreshRepo();

    expect(useStore.getState().eventTypes.find((t) => t.id === type.id)?.name).toBe('Migraine');
    expect(useStore.getState().eventInstances.find((e) => e.id === inst.id)?.values.severity).toBe(
      4,
    );
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

  // Stage 24 (FR-24.2/AC1). `logEvent` used to build the EventInstance
  // field-by-field, so any field added to `EventInstanceInput` later was
  // silently dropped on the way to IndexedDB — the entity type compiled, the
  // UI compiled, and the attribution just wasn't there after a reload. This
  // asserts the round-trip at store level so a re-introduction of that drop
  // fails here and not only in a screen test.
  it('an attributed event survives logEvent -> IndexedDB -> rehydrate (Stage 24)', async () => {
    await useStore.getState().hydrate();
    useStore.setState({ medications: [], slots: [], eventTypes: [], eventInstances: [] });

    const med = useStore.getState().addMedication({ ...MED_INPUT, name: 'Levetiracetam' });
    useStore.getState().addSlot({ time: '08:00', items: [{ medId: med.id, dose: 500 }] });
    const slotId = useStore.getState().slots[0]!.id;
    const scheduledInstant = Date.UTC(2026, 5, 18, 7, 0);
    const dose = useStore.getState().logDose({
      slotId,
      medId: med.id,
      scheduledInstant,
      dose: 500,
      actualInstant: scheduledInstant,
    });

    const type = useStore.getState().addEventType({
      name: 'Drowsiness',
      color: '#9333ea',
      properties: [],
      category: 'side-effect',
    });
    expect(useStore.getState().eventTypes.find((t) => t.id === type.id)?.category).toBe(
      'side-effect',
    );

    const inst = useStore.getState().logEvent({
      typeId: type.id,
      occurredAt: scheduledInstant + 3600_000,
      values: {},
      medId: med.id,
      doseLogEntryId: dose.id,
    });
    // Present in the returned entity, not merely accepted by the input type.
    expect(inst.medId).toBe(med.id);
    expect(inst.doseLogEntryId).toBe(dose.id);
    // The store still stamps the zone itself; a caller cannot supply one.
    expect(inst.zone).toBe(useStore.getState().settings.zone);

    await reloadFromFreshRepo();

    const reloaded = useStore.getState().eventInstances.find((e) => e.id === inst.id);
    expect(reloaded?.medId).toBe(med.id);
    expect(reloaded?.doseLogEntryId).toBe(dose.id);
    expect(useStore.getState().eventTypes.find((t) => t.id === type.id)?.category).toBe(
      'side-effect',
    );
  });

  it('an unattributed event round-trips with the attribution fields absent (Stage 24 AC3)', async () => {
    await useStore.getState().hydrate();
    const type = useStore
      .getState()
      .addEventType({ name: 'Seizure', color: '#9333ea', properties: [] });
    const inst = useStore
      .getState()
      .logEvent({ typeId: type.id, occurredAt: Date.now(), values: {} });

    await reloadFromFreshRepo();

    const reloaded = useStore.getState().eventInstances.find((e) => e.id === inst.id);
    expect(reloaded).toBeTruthy();
    expect(reloaded?.medId).toBeUndefined();
    expect(reloaded?.doseLogEntryId).toBeUndefined();
    expect(useStore.getState().eventTypes.find((t) => t.id === type.id)?.category).toBeUndefined();
  });

  // `logEvent` spreads `input` *before* the app-stamped fields (`id`, `zone`,
  // `updatedAt`) precisely so a caller can never override them — the mirror
  // image of the field-drop bug above. `EventInstanceInput` doesn't declare
  // any of those three names today, so an ordinary call can't exercise this;
  // the cast below simulates a future/misbehaving caller supplying one
  // anyway, to prove the stamping wins regardless of spread contents.
  it('logEvent never lets the input override the app-stamped id/zone/updatedAt', async () => {
    await useStore.getState().hydrate();
    const type = useStore
      .getState()
      .addEventType({ name: 'Seizure', color: '#9333ea', properties: [] });

    const spoofed = {
      typeId: type.id,
      occurredAt: Date.now(),
      values: {},
      id: 'spoofed-id',
      zone: 'Spoofed/Zone',
      updatedAt: 1,
    } as unknown as EventInstanceInput;

    const inst = useStore.getState().logEvent(spoofed);
    expect(inst.id).not.toBe('spoofed-id');
    expect(inst.zone).toBe(useStore.getState().settings.zone);
    expect(inst.updatedAt).not.toBe(1);
  });

  it('emits one regimen change per meaningful edit and none for a no-op (Stage 16 AC1)', async () => {
    const med = await freshRegimen();
    expect(liveChanges().map((c) => c.kind)).toEqual(['medication-added']);

    // A real prescription edit records a medication-updated change.
    useStore.getState().updateMedication(med.id, { name: 'Renamed' });
    expect(liveChanges().map((c) => c.kind)).toEqual(['medication-added', 'medication-updated']);
    const updated = liveChanges().at(-1)!;
    expect(updated.summary).toContain('Renamed');
    expect(updated.changes).toContainEqual(
      expect.objectContaining({ field: 'Name', from: 'Test', to: 'Renamed', key: 'med.name' }),
    );

    // A no-op save (same name) records nothing further.
    useStore.getState().updateMedication(med.id, { name: 'Renamed' });
    expect(liveChanges()).toHaveLength(2);

    // Retiring the medication records a medication-retired change.
    useStore.getState().deleteMedication(med.id);
    expect(liveChanges().at(-1)!.kind).toBe('medication-retired');
  });

  // FR-18.1 piece 3 — setting/editing `startedAt` is itself a regimen change,
  // not a silent field like the others `updateMedication` touches.
  it('records a medication-updated change when startedAt is set/edited afterwards', async () => {
    const med = await freshRegimen(); // added with no startedAt
    expect(med.startedAt).toBeUndefined();
    expect(
      liveChanges()
        .at(-1)!
        .changes.some((c) => c.key === 'med.startedAt'),
    ).toBe(false);

    const zone = useStore.getState().settings.zone;
    const startedAt = resolveWallTimeToInstant('2026-06-01', '00:00', zone);
    useStore.getState().updateMedication(med.id, { startedAt });
    let change = liveChanges().at(-1)!;
    expect(change.kind).toBe('medication-updated');
    expect(change.changes).toContainEqual(
      expect.objectContaining({
        key: 'med.startedAt',
        field: 'Start date',
        from: null,
        to: '2026-06-01',
        fromValue: null,
        toValue: startedAt,
      }),
    );
    expect(useStore.getState().medications.find((m) => m.id === med.id)?.startedAt).toBe(startedAt);

    // Editing an already-set date afterwards records another change.
    const startedAt2 = resolveWallTimeToInstant('2026-06-05', '00:00', zone);
    useStore.getState().updateMedication(med.id, { startedAt: startedAt2 });
    change = liveChanges().at(-1)!;
    expect(change.changes).toContainEqual(
      expect.objectContaining({ key: 'med.startedAt', from: '2026-06-01', to: '2026-06-05' }),
    );

    // A no-op save (same date) records nothing further.
    const before = liveChanges().length;
    useStore.getState().updateMedication(med.id, { startedAt: startedAt2 });
    expect(liveChanges()).toHaveLength(before);
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
    expect(updated.changes).toContainEqual(
      expect.objectContaining({
        field: 'Test dose',
        from: '100mg',
        to: '150mg',
        key: 'slot.dose',
        medId: med.id,
        slotId: slot.id,
        fromValue: 100,
        toValue: 150,
      }),
    );

    useStore.getState().deleteSlot(slot.id);
    expect(liveChanges().at(-1)!.kind).toBe('slot-removed');
  });

  // G2 — a hard delete strips the medication from every slot and tombstones any
  // slot left empty. Those cascade edits used to be recorded nowhere: the whole
  // diff was "Status Active → Retired".
  it('records the slot cascade of a hard medication delete (FR-18.1 G2)', async () => {
    const med = await freshRegimen();
    const other = useStore.getState().addMedication({ ...MED_INPUT, name: 'Other' });
    // Morning holds both meds (survives the delete); Evening holds only the
    // deleted med (is tombstoned by the cascade).
    const morning = useStore.getState().addSlot({
      time: '08:00',
      label: 'Morning',
      items: [
        { medId: med.id, dose: 150 },
        { medId: other.id, dose: 500 },
      ],
    });
    const evening = useStore
      .getState()
      .addSlot({ time: '20:00', items: [{ medId: med.id, dose: 200 }] });
    useStore.setState({ regimenChanges: [] });

    useStore.getState().deleteMedication(med.id);

    // Still one marker for the whole delete...
    expect(liveChanges()).toHaveLength(1);
    const change = liveChanges()[0]!;
    expect(change.kind).toBe('medication-retired');

    // ...but the cascade is inside its diff, keyed by slot and medication.
    const cascade = change.changes.filter((c) => c.key === 'slot.dose');
    expect(cascade).toHaveLength(2);
    expect(cascade).toContainEqual(
      expect.objectContaining({
        key: 'slot.dose',
        medId: med.id,
        slotId: morning.id,
        fromValue: 150,
        toValue: null,
        from: '150mg',
      }),
    );
    expect(cascade).toContainEqual(
      expect.objectContaining({
        key: 'slot.dose',
        medId: med.id,
        slotId: evening.id,
        fromValue: 200,
        toValue: null,
      }),
    );

    // The emptied slot's own removal is recorded; the surviving one's is not.
    const removed = change.changes.filter((c) => c.key === 'slot.removed');
    expect(removed).toHaveLength(1);
    expect(removed[0]!.slotId).toBe(evening.id);

    // And the state matches what the diff claims.
    const slots = useStore.getState().slots;
    expect(slots.find((s) => s.id === evening.id)?.deleted).toBe(true);
    expect(slots.find((s) => s.id === morning.id)?.deleted).toBeFalsy();
    expect(slots.find((s) => s.id === morning.id)?.items.map((i) => i.medId)).toEqual([other.id]);
  });

  it('records no cascade when the deleted medication was in no slot (FR-18.1 G2)', async () => {
    const med = await freshRegimen();
    useStore.setState({ regimenChanges: [] });

    useStore.getState().deleteMedication(med.id);
    const change = liveChanges()[0]!;
    expect(change.changes.map((c) => c.key)).toEqual(['med.active']);
  });

  // G3 — creating and resuming a medication were both `medication-added`.
  it('distinguishes a reactivation from a first prescription (FR-18.1 G3)', async () => {
    const med = await freshRegimen();
    expect(liveChanges().at(-1)!.kind).toBe('medication-added');

    // Soft-retire, then resume. The soft path leaves slot items intact.
    useStore.getState().updateMedication(med.id, { active: false });
    expect(liveChanges().at(-1)!.kind).toBe('medication-retired');

    useStore.getState().updateMedication(med.id, { active: true });
    const resumed = liveChanges().at(-1)!;
    expect(resumed.kind).toBe('medication-reactivated');
    expect(resumed.summary).toBe('Resumed Test');
    expect(resumed.changes).toEqual([
      expect.objectContaining({
        key: 'med.active',
        medId: med.id,
        fromValue: false,
        toValue: true,
      }),
    ]);
    expect(liveChanges().map((c) => c.kind)).toEqual([
      'medication-added',
      'medication-retired',
      'medication-reactivated',
    ]);
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
    await reloadFromFreshRepo();
    expect(useStore.getState().medications.length).toBe(firstCount);
  });
});

// ---- Stage 18 FR-18.1: effective-dated snapshot capture -----------------------
//
// The resolver in core is only as good as what the store feeds it, so these
// assert that every regimen-mutating action leaves behind a snapshot — and that
// the *first* one is a baseline capturing the pre-edit state.

describe('schedule snapshots (Stage 18 FR-18.1)', () => {
  it('captures a baseline of the pre-edit regimen plus the post-edit state', () => {
    const store = useStore.getState();
    const medA = store.addMedication({ ...MED_INPUT, name: 'A' });
    useStore.getState().addSlot({ time: '08:00', items: [{ medId: medA.id, dose: 100 }] });

    // The baseline is stamped at the epoch: it claims every day before the first
    // recorded edit, which is the only honest answer for unrecorded history.
    expect(snapshots()[0]!.effectiveFrom).toBe(0);
    expect(snapshots()[0]!.medications).toEqual([]);
    expect(snapshots()[0]!.slots).toEqual([]);

    // One snapshot per mutation thereafter, each holding the post-edit regimen.
    const latest = snapshots()[snapshots().length - 1]!;
    expect(latest.medications.map((m) => m.name)).toEqual(['A']);
    expect(latest.slots[0]!.items[0]!.dose).toBe(100);
  });

  it('records a snapshot for every regimen-mutating action', () => {
    const s = () => useStore.getState();
    const medA = s().addMedication({ ...MED_INPUT, name: 'A' });
    const before = snapshots().length;

    const slotA = s().addSlot({ time: '08:00', items: [{ medId: medA.id, dose: 100 }] });
    s().updateSlot(slotA.id, { items: [{ medId: medA.id, dose: 200 }] });
    s().updateMedication(medA.id, { name: 'A2' });
    s().deleteSlot(slotA.id);
    s().deleteMedication(medA.id);

    expect(snapshots().length).toBe(before + 5);
  });

  it('preserves the earlier dose in the earlier snapshot after a dose change (AC1)', () => {
    const s = () => useStore.getState();
    const medA = s().addMedication({ ...MED_INPUT, name: 'A' });
    const slotA = s().addSlot({ time: '08:00', items: [{ medId: medA.id, dose: 100 }] });
    const beforeEdit = snapshots()[snapshots().length - 1]!;

    s().updateSlot(slotA.id, { items: [{ medId: medA.id, dose: 250 }] });

    // The pre-edit snapshot must be untouched by the edit — this is what makes
    // yesterday keep showing 100.
    expect(beforeEdit.slots[0]!.items[0]!.dose).toBe(100);
    expect(snapshots()[snapshots().length - 1]!.slots[0]!.items[0]!.dose).toBe(250);
    // ...and it must still read 100 from the store, not just from the local ref.
    const stored = snapshots().find((x) => x.id === beforeEdit.id)!;
    expect(stored.slots[0]!.items[0]!.dose).toBe(100);
  });

  it('keeps a retired medication active in the snapshot covering its active days (AC2)', () => {
    const s = () => useStore.getState();
    const medA = s().addMedication({ ...MED_INPUT, name: 'A' });
    s().addSlot({ time: '08:00', items: [{ medId: medA.id, dose: 100 }] });
    const whileActive = snapshots()[snapshots().length - 1]!;

    s().deleteMedication(medA.id);

    expect(whileActive.medications[0]!.active).toBe(true);
    expect(whileActive.medications[0]!.deleted).toBeFalsy();
    expect(whileActive.slots[0]!.items).toHaveLength(1);
    // The current state has both the tombstone and the slot cascade applied.
    const latest = snapshots()[snapshots().length - 1]!;
    expect(latest.medications[0]!.deleted).toBe(true);
  });

  it('does not add a second baseline once snapshots exist', () => {
    const s = () => useStore.getState();
    s().addMedication({ ...MED_INPUT, name: 'A' });
    s().addMedication({ ...MED_INPUT, name: 'B' });
    expect(snapshots().filter((x) => x.effectiveFrom === 0)).toHaveLength(1);
  });
});

// FR-18.1 follow-up. A single Save in the merged editor fires 2-4 mutating
// actions synchronously. One snapshot per action meant several snapshots sharing
// a millisecond, and `resolveScheduleAsOf` could only break that tie by random
// UUID — so a past day could render an intermediate regimen the user never saved
// (the reported repro: a mid-edit dose of 999 winning over the final 150 purely
// because its id sorted later). The bracket now collapses the whole edit.

describe('bracketed regimen edits collapse to one snapshot (FR-18.1 follow-up)', () => {
  const s = () => useStore.getState();

  /**
   * Prescribe medication A with a single 08:00 dose of 100mg. This is itself one
   * Save — the editor fires addMedication + addSlot — so it is bracketed too.
   */
  const prescribe = () =>
    s().runRegimenEdit(() => {
      const medA = s().addMedication({ ...MED_INPUT, name: 'A' });
      const slotA = s().addSlot({ time: '08:00', items: [{ medId: medA.id, dose: 100 }] });
      return { medA, slotA };
    });

  /**
   * One Save that passes through an intermediate 999mg before settling on 150mg
   * — the shape of the reported bug, where the intermediate could win the tie.
   */
  const saveDoseVia999 = ({ medA, slotA }: ReturnType<typeof prescribe>) =>
    s().runRegimenEdit(() => {
      s().updateSlot(slotA.id, { items: [{ medId: medA.id, dose: 999 }] }); // intermediate
      s().updateSlot(slotA.id, { items: [{ medId: medA.id, dose: 150 }] }); // final
    });

  it('appends exactly one snapshot for an edit made of several actions', () => {
    const medA = s().addMedication({ ...MED_INPUT, name: 'A' });
    const slotA = s().addSlot({ time: '08:00', items: [{ medId: medA.id, dose: 100 }] });
    const before = snapshots().length;

    // What one Save does: touch the medication, then re-plan its slots.
    s().runRegimenEdit(() => {
      s().updateMedication(medA.id, { name: 'A2' });
      s().updateSlot(slotA.id, { items: [{ medId: medA.id, dose: 999 }] }); // intermediate
      s().updateSlot(slotA.id, { items: [{ medId: medA.id, dose: 150 }] }); // final
    });

    expect(snapshots().length).toBe(before + 1);
  });

  it('captures the final state of the edit, never an intermediate one', () => {
    saveDoseVia999(prescribe());

    const latest = snapshots()[snapshots().length - 1]!;
    expect(latest.slots[0]!.items[0]!.dose).toBe(150);
    // The intermediate value must exist in NO snapshot at all.
    expect(
      snapshots().some((x) => x.slots.some((sl) => sl.items.some((i) => i.dose === 999))),
    ).toBe(false);
  });

  it('resolves the edited day to the final regimen, deterministically, every run', () => {
    // The reported failure was probabilistic — it depended on how two
    // same-millisecond snapshots' random UUIDs happened to sort — so repeat it
    // with fresh ids each time. Fake timers put the earlier setup at a distinct
    // instant, as real use would: a user prescribes a medication, and Saves an
    // edit to it later. The only actions still sharing a millisecond are the
    // ones inside the Save, and those now yield a single snapshot.
    vi.useFakeTimers();
    try {
      for (let run = 0; run < 25; run++) {
        resetStore();
        vi.setSystemTime(new Date('2026-07-20T09:00:00Z'));
        const prescribed = prescribe();

        vi.setSystemTime(new Date('2026-07-22T09:00:00Z'));
        saveDoseVia999(prescribed);

        const st = s();
        const today = isoDateInZone(Date.now(), st.settings.zone);
        const resolved = resolveScheduleAsOf(st, today, st.settings.zone);
        expect(resolved.slots[0]!.items[0]!.dose).toBe(150);

        // ...and the day before the edit still shows the original 100 (AC1).
        const before = resolveScheduleAsOf(st, '2026-07-21', st.settings.zone);
        expect(before.slots[0]!.items[0]!.dose).toBe(100);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('still captures the pre-edit baseline when the snapshot log is empty', () => {
    // A pre-upgrade dataset: no snapshots yet, and the first thing the user does
    // is a multi-action Save. The baseline must still protect prior history.
    expect(snapshots()).toHaveLength(0);
    const medA = s().addMedication({ ...MED_INPUT, name: 'A' });

    resetStore();
    useStore.setState({ medications: [medA], slots: [], scheduleSnapshots: [] });

    s().runRegimenEdit(() => {
      s().updateMedication(medA.id, { name: 'A2' });
      s().addSlot({ time: '08:00', items: [{ medId: medA.id, dose: 100 }] });
    });

    // Exactly two: the epoch baseline holding the pre-edit regimen, and one
    // snapshot for the edit itself.
    expect(snapshots()).toHaveLength(2);
    expect(snapshots()[0]!.effectiveFrom).toBe(0);
    expect(snapshots()[0]!.medications.map((m) => m.name)).toEqual(['A']);
    expect(snapshots()[0]!.slots).toEqual([]);
    expect(snapshots()[1]!.medications.map((m) => m.name)).toEqual(['A2']);
    expect(snapshots()[1]!.slots[0]!.items[0]!.dose).toBe(100);
  });

  it('nests without losing the snapshot when an inner action returns early', () => {
    // `updateSlot`/`updateMedication` bail out when the id is unknown. If that
    // path skipped its close, the bracket depth would leak and every later edit
    // would silently stop being recorded.
    const medA = s().addMedication({ ...MED_INPUT, name: 'A' });
    const before = snapshots().length;

    s().runRegimenEdit(() => {
      s().updateSlot('does-not-exist', { time: '09:00' });
      s().updateMedication('also-missing', { name: 'X' });
    });
    expect(snapshots().length).toBe(before + 1);

    // The bracket is closed, so an ordinary later edit still records.
    s().updateMedication(medA.id, { name: 'A2' });
    expect(snapshots().length).toBe(before + 2);
    expect(snapshots()[snapshots().length - 1]!.medications.map((m) => m.name)).toEqual(['A2']);
  });

  it('leaves the Stage 16 change records untouched in kind and count (AC14)', () => {
    // Collapsing snapshots must not touch the separate `RegimenChange` mechanism:
    // one marker per action, exactly as before.
    const medA = s().addMedication({ ...MED_INPUT, name: 'A' });
    const slotA = s().addSlot({ time: '08:00', items: [{ medId: medA.id, dose: 100 }] });

    s().runRegimenEdit(() => {
      s().updateMedication(medA.id, { name: 'A2' });
      s().updateSlot(slotA.id, { items: [{ medId: medA.id, dose: 150 }] });
    });

    expect(liveChanges().map((c) => c.kind)).toEqual([
      'medication-added',
      'slot-added',
      'medication-updated',
      'slot-updated',
    ]);
  });
});
