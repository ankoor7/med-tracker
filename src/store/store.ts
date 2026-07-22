import { create } from 'zustand';
import {
  addDaysToIsoDate,
  buildRegimenChange,
  checkGuardrails,
  describeMedicationAdded,
  describeMedicationReactivated,
  describeMedicationRetired,
  describeMedicationSlotCascade,
  describeMedicationStartDate,
  describeSlot,
  diffMedication,
  diffMedicationStartDate,
  diffSlot,
  entryMatchesOccurrence,
  isoDateInZone,
  newId,
  normalizeOuraData,
  overrideMatchesOccurrence,
  slotSubject,
  buildScheduleSnapshot,
  type DoseLogEntry,
  type DoseOverride,
  type EventInstance,
  type EventPropertyDef,
  type EventPropertyValue,
  type EventType,
  type Guardrails,
  type Instant,
  type Medication,
  type OuraDaySummary,
  type RegimenChange,
  type ScheduleItem,
  type ScheduleSnapshot,
  type Settings,
  type Slot,
  type SlotCascadeRemoval,
} from '../core';
import { getRepository, type TableName } from './repository';
import { getOuraClient } from '../oura/registry';
import { seedDataset } from './seed';
import { mergeDatasets, type ImportMode } from './transfer';
import { BASELINE_SNAPSHOT_AT } from './migrations';
import type { Dataset } from '../core/types';

/** Days of Oura history to fetch/overlay; at least two weeks for a useful chart. */
const OURA_WINDOW_DAYS = 30;
export type OuraStatus = 'idle' | 'syncing' | 'synced' | 'error';

// ---- Input types (UI-facing) --------------------------------------------------

export interface MedicationInput {
  name: string;
  color: string;
  unit: string;
  halfLifeHours: number;
  adjustWhenLate: boolean;
  active: boolean;
  notes?: string;
  guardrails: Guardrails;
  // When this medication was first prescribed (Stage 18 FR-18.1 piece 3).
  // Optional: absent means "treat as always prescribed" — see `Medication.startedAt`.
  startedAt?: Instant;
}

export interface SlotInput {
  time: string;
  label?: string;
  items: ScheduleItem[];
}

export interface LogDoseInput {
  slotId: string;
  medId: string;
  scheduledInstant: Instant;
  dose: number;
  actualInstant: Instant;
}

export interface DoseOverrideInput {
  slotId: string;
  medId: string;
  scheduledInstant: Instant;
  dose: number;
  note?: string;
}

export interface EventTypeInput {
  name: string;
  color: string;
  properties: EventPropertyDef[];
  notes?: string;
}

export interface EventInstanceInput {
  typeId: string;
  occurredAt: Instant;
  values: Record<string, EventPropertyValue>;
  note?: string;
}

interface StoreState {
  hydrated: boolean;
  medications: Medication[];
  slots: Slot[];
  doseLog: DoseLogEntry[];
  doseOverrides: DoseOverride[];
  eventTypes: EventType[];
  eventInstances: EventInstance[];
  regimenChanges: RegimenChange[];
  scheduleSnapshots: ScheduleSnapshot[];
  settings: Settings;

  // ---- Oura health data (Stage 13) -----------------------------------------
  ouraSummaries: OuraDaySummary[];
  ouraStatus: OuraStatus;
  ouraLastSyncedAt: number | null;
  ouraError: string | null;

  hydrate: () => Promise<void>;
  /** Re-read the repository into memory after a sync applied remote changes. */
  reload: () => Promise<void>;

  /** Fetch the last `OURA_WINDOW_DAYS` of Oura data via the active client. */
  syncOura: () => Promise<void>;

  addMedication: (input: MedicationInput) => Medication;
  updateMedication: (id: string, patch: Partial<MedicationInput>) => void;
  deleteMedication: (id: string) => void;

  addSlot: (input: SlotInput) => Slot;
  updateSlot: (id: string, patch: Partial<SlotInput>) => void;
  deleteSlot: (id: string) => void;

  logDose: (input: LogDoseInput) => DoseLogEntry;
  takeGroup: (slotId: string, scheduledInstant: Instant) => DoseLogEntry[];
  deleteLogEntry: (id: string) => void;

  /**
   * Re-time an already-logged dose (calendar drag, Stage 13). Moves only the
   * `actualInstant`; the dose amount is untouched (the app never originates a
   * value). Re-runs the shared guardrail check at the new time and stores the
   * refreshed warnings.
   */
  adjustDoseTime: (id: string, actualInstant: Instant) => DoseLogEntry | undefined;

  /**
   * Correct an already-logged dose's amount and/or time (Stage 18 FR-18.2,
   * Today/History edit paths). Re-runs the shared guardrail check with the
   * entry excluded from its own history. A correction of the record, not a
   * regimen change — never records a Stage 16 `RegimenChange`.
   */
  editLogEntry: (
    id: string,
    patch: { dose?: number; actualInstant?: Instant },
  ) => DoseLogEntry | undefined;

  /** Set/replace a one-time override of a future occurrence's dose (Stage 12). */
  setDoseOverride: (input: DoseOverrideInput) => DoseOverride;
  clearDoseOverride: (id: string) => void;

  // ---- Health-condition event tracking (Stage 13) ---------------------------
  addEventType: (input: EventTypeInput) => EventType;
  updateEventType: (id: string, patch: Partial<EventTypeInput>) => void;
  setEventTypeArchived: (id: string, archived: boolean) => void;

  logEvent: (input: EventInstanceInput) => EventInstance;
  updateEventInstance: (id: string, patch: Partial<EventInstanceInput>) => void;
  deleteEventInstance: (id: string) => void;

  updateSettings: (patch: Partial<Omit<Settings, 'updatedAt' | 'version'>>) => void;

  // ---- Regimen change markers (Stage 16) ------------------------------------
  /** Attach/replace a free-text note on a derived regimen change. */
  addChangeNote: (id: string, note: string) => void;
  /** Soft-delete (tombstone) a regimen change so its marker disappears. */
  deleteChange: (id: string) => void;

  /** Apply an imported dataset (Stage 7), replacing or LWW-merging the current. */
  importData: (incoming: Dataset, mode: ImportMode) => void;
}

// ---- Helpers ------------------------------------------------------------------

function stamp<T extends { updatedAt: Instant; version?: number }>(record: T, now: Instant): T {
  return { ...record, updatedAt: now, version: (record.version ?? 0) + 1 };
}

// Fire-and-forget persistence; the repository is the no-op nullRepository in
// Stage 1 and a LocalRepository from Stage 2 on.
function persistUpsert<T extends { id: string }>(table: TableName, record: T): void {
  void getRepository()
    .upsert(table, record)
    .catch((e) => console.error('persist upsert failed', table, e));
}
function persistSettings(settings: Settings): void {
  void getRepository()
    .putSettings(settings)
    .catch((e) => console.error('persist settings failed', e));
}

function scheduledDoseFor(slots: Slot[], slotId: string, medId: string): number | null {
  const item = slots.find((s) => s.id === slotId)?.items.find((i) => i.medId === medId);
  return item ? item.dose : null;
}

// ---- Store --------------------------------------------------------------------

export const useStore = create<StoreState>((set, get) => {
  // Append a derived regimen change to state and queue it for sync. Centralises
  // the "derive, don't author" path so every edit site records identically.
  const recordChange = (change: RegimenChange): void => {
    set((s) => ({ regimenChanges: [...s.regimenChanges, change] }));
    persistUpsert('regimenChanges', change);
  };

  const addSnapshot = (snapshot: ScheduleSnapshot): void => {
    set((s) => ({ scheduleSnapshots: [...s.scheduleSnapshots, snapshot] }));
    persistUpsert('scheduleSnapshots', snapshot);
  };

  // Stage 18 FR-18.1. These two bracket every regimen-mutating action so past
  // days can be rendered from the regimen that was actually in effect on them.
  //
  // `beginRegimenEdit` guards the case where the snapshot log is still empty
  // (a dataset that never ran the v2 migration): without a baseline capturing
  // the *pre-edit* regimen, this edit's snapshot would become the earliest one
  // and resolution would project the post-edit state back over all history.
  const beginRegimenEdit = (): void => {
    const { scheduleSnapshots, medications, slots, settings } = get();
    if (scheduleSnapshots.length > 0) return;
    addSnapshot(
      buildScheduleSnapshot(newId(), medications, slots, BASELINE_SNAPSHOT_AT, settings.zone),
    );
  };

  /** Capture the post-edit regimen as taking effect at `now`. */
  const endRegimenEdit = (now: Instant): void => {
    const { medications, slots, settings } = get();
    addSnapshot(buildScheduleSnapshot(newId(), medications, slots, now, settings.zone));
  };

  return {
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
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London',
      adherenceWindowDays: 7,
      missedDayThreshold: 3,
      assumeTakenOnTime: true,
      updatedAt: 0,
    },

    ouraSummaries: [],
    ouraStatus: 'idle',
    ouraLastSyncedAt: null,
    ouraError: null,

    hydrate: async () => {
      const repo = getRepository();
      const oura = await repo.loadOura();
      if (oura.length > 0) set({ ouraSummaries: oura });
      const loaded = await repo.loadAll();
      if (loaded) {
        set({ ...loaded, hydrated: true });
        return;
      }
      // Test seam: the E2E suite needs a genuinely empty first run (no demo data
      // bleeding into sync assertions), so it sets VITE_DISABLE_SEED. Normal dev
      // and production are unaffected.
      if (import.meta.env.VITE_DISABLE_SEED) {
        set({ hydrated: true });
        return;
      }
      // First run: seed.
      const data = seedDataset(Date.now());
      set({ ...data, hydrated: true });
      for (const m of data.medications) persistUpsert('medications', m);
      for (const s of data.slots) persistUpsert('slots', s);
      for (const t of data.eventTypes) persistUpsert('eventTypes', t);
      for (const c of data.regimenChanges) persistUpsert('regimenChanges', c);
      for (const s of data.scheduleSnapshots) persistUpsert('scheduleSnapshots', s);
      persistSettings(data.settings);
    },

    reload: async () => {
      const loaded = await getRepository().loadAll();
      if (loaded) set({ ...loaded });
    },

    syncOura: async () => {
      const { settings } = get();
      set({ ouraStatus: 'syncing', ouraError: null });
      try {
        const endDate = isoDateInZone(Date.now(), settings.zone);
        const startDate = addDaysToIsoDate(endDate, -(OURA_WINDOW_DAYS - 1));
        const range = { startDate, endDate };
        const client = getOuraClient();
        const [readiness, stress] = await Promise.all([
          client.getDailyReadiness(range),
          client.getDailyStress(range),
        ]);
        const summaries = normalizeOuraData(readiness, stress, settings.zone);
        // Persist before flipping to 'synced' so a reload sees the cache; a save
        // failure is non-fatal (the in-memory data is still good).
        try {
          await getRepository().saveOura(summaries);
        } catch (e) {
          console.error('persist oura failed', e);
        }
        set({
          ouraSummaries: summaries,
          ouraStatus: 'synced',
          ouraLastSyncedAt: Date.now(),
        });
      } catch (e) {
        set({ ouraStatus: 'error', ouraError: e instanceof Error ? e.message : String(e) });
      }
    },

    addMedication: (input) => {
      const now = Date.now();
      const zone = get().settings.zone;
      beginRegimenEdit();
      const med: Medication = stamp({ id: newId(), updatedAt: now, ...input }, now);
      set((s) => ({ medications: [...s.medications, med] }));
      persistUpsert('medications', med);
      recordChange(
        buildRegimenChange({
          kind: 'medication-added',
          subject: med.name,
          medId: med.id,
          changes: [...describeMedicationAdded(med), ...describeMedicationStartDate(med, zone)],
          now,
          zone,
        }),
      );
      endRegimenEdit(now);
      return med;
    },

    updateMedication: (id, patch) => {
      const now = Date.now();
      const zone = get().settings.zone;
      beginRegimenEdit();
      let prev: Medication | undefined;
      let updated: Medication | undefined;
      set((s) => ({
        medications: s.medications.map((m) => {
          if (m.id !== id) return m;
          prev = m;
          updated = stamp({ ...m, ...patch }, now);
          return updated;
        }),
      }));
      if (!prev || !updated) return;
      persistUpsert('medications', updated);
      // `startedAt` can change alongside any of the three transitions below, so
      // it's diffed once and folded into whichever change ends up recorded.
      const startDateChanges = diffMedicationStartDate(prev, updated, zone);
      // Derive a change from the pre-edit entity. An active → inactive transition
      // is a retirement; the reverse re-introduces the medication; otherwise a
      // prescription edit records only the fields that actually differ (no-op = none).
      if (prev.active && !updated.active) {
        recordChange(
          buildRegimenChange({
            kind: 'medication-retired',
            subject: updated.name,
            medId: id,
            changes: [...describeMedicationRetired(updated), ...startDateChanges],
            now,
            zone,
          }),
        );
      } else if (!prev.active && updated.active) {
        // Resuming an existing prescription is not the same event as first
        // prescribing one; recording both as `medication-added` made the two
        // indistinguishable to anyone reading the history back.
        recordChange(
          buildRegimenChange({
            kind: 'medication-reactivated',
            subject: updated.name,
            medId: id,
            changes: [...describeMedicationReactivated(updated), ...startDateChanges],
            now,
            zone,
          }),
        );
      } else {
        const changes = [...diffMedication(prev, updated), ...startDateChanges];
        if (changes.length > 0) {
          recordChange(
            buildRegimenChange({
              kind: 'medication-updated',
              subject: updated.name,
              medId: id,
              changes,
              now,
              zone,
            }),
          );
        }
      }
      endRegimenEdit(now);
    },

    deleteMedication: (id) => {
      const now = Date.now();
      const zone = get().settings.zone;
      beginRegimenEdit();
      let tombstoned: Medication | undefined;
      const affectedSlots: Slot[] = [];
      const removals: SlotCascadeRemoval[] = [];
      set((s) => {
        const medications = s.medications.map((m) => {
          if (m.id !== id) return m;
          tombstoned = stamp({ ...m, deleted: true }, now);
          return tombstoned;
        });
        // FR-MED-4: remove the med from every slot; tombstone now-empty slots.
        const slots = s.slots.map((slot) => {
          const removed = slot.deleted ? undefined : slot.items.find((i) => i.medId === id);
          if (!removed) return slot;
          const items = slot.items.filter((i) => i.medId !== id);
          const slotRemoved = items.length === 0;
          const next = stamp(
            slotRemoved ? { ...slot, items, deleted: true } : { ...slot, items },
            now,
          );
          // Capture the *pre-edit* slot: it still names the affected occurrence
          // and carries the dose that is about to disappear.
          removals.push({ slot, dose: removed.dose, slotRemoved });
          affectedSlots.push(next);
          return next;
        });
        return { medications, slots };
      });
      if (tombstoned) persistUpsert('medications', tombstoned);
      for (const slot of affectedSlots) persistUpsert('slots', slot);
      // Retiring the medication subsumes the cascade slot edits into one marker
      // — but the cascade is now recorded in that marker's diff rather than lost.
      if (tombstoned) {
        const med = tombstoned;
        recordChange(
          buildRegimenChange({
            kind: 'medication-retired',
            subject: med.name,
            medId: id,
            changes: [
              ...describeMedicationRetired(med),
              ...describeMedicationSlotCascade(med, removals),
            ],
            now,
            zone,
          }),
        );
      }
      endRegimenEdit(now);
    },

    addSlot: (input) => {
      const now = Date.now();
      const { settings, medications } = get();
      beginRegimenEdit();
      const slot: Slot = stamp({ id: newId(), updatedAt: now, ...input }, now);
      set((s) => ({ slots: [...s.slots, slot] }));
      persistUpsert('slots', slot);
      const medsById = new Map(medications.map((m) => [m.id, m]));
      recordChange(
        buildRegimenChange({
          kind: 'slot-added',
          subject: slotSubject(slot),
          slotId: slot.id,
          changes: describeSlot(slot, medsById, 'added'),
          now,
          zone: settings.zone,
        }),
      );
      endRegimenEdit(now);
      return slot;
    },

    updateSlot: (id, patch) => {
      const now = Date.now();
      const { settings, medications } = get();
      beginRegimenEdit();
      let prev: Slot | undefined;
      let updated: Slot | undefined;
      set((s) => ({
        slots: s.slots.map((slot) => {
          if (slot.id !== id) return slot;
          prev = slot;
          updated = stamp({ ...slot, ...patch }, now);
          return updated;
        }),
      }));
      if (!prev || !updated) return;
      persistUpsert('slots', updated);
      const medsById = new Map(medications.map((m) => [m.id, m]));
      const changes = diffSlot(prev, updated, medsById);
      if (changes.length > 0) {
        recordChange(
          buildRegimenChange({
            kind: 'slot-updated',
            subject: slotSubject(updated),
            slotId: id,
            changes,
            now,
            zone: settings.zone,
          }),
        );
      }
      endRegimenEdit(now);
    },

    deleteSlot: (id) => {
      const now = Date.now();
      const { settings, medications } = get();
      beginRegimenEdit();
      let tombstoned: Slot | undefined;
      set((s) => ({
        slots: s.slots.map((slot) => {
          if (slot.id !== id) return slot;
          tombstoned = stamp({ ...slot, deleted: true }, now);
          return tombstoned;
        }),
      }));
      if (!tombstoned) return;
      persistUpsert('slots', tombstoned);
      const medsById = new Map(medications.map((m) => [m.id, m]));
      recordChange(
        buildRegimenChange({
          kind: 'slot-removed',
          subject: slotSubject(tombstoned),
          slotId: id,
          changes: describeSlot(tombstoned, medsById, 'removed'),
          now,
          zone: settings.zone,
        }),
      );
      endRegimenEdit(now);
    },

    logDose: (input) => {
      const { medications, slots, doseLog, settings } = get();
      const now = Date.now();
      const med = medications.find((m) => m.id === input.medId);
      const unit = med?.unit ?? '';
      const warnings = med
        ? checkGuardrails(med, input.dose, input.actualInstant, doseLog, settings.zone)
        : [];
      const normalDose = scheduledDoseFor(slots, input.slotId, input.medId);

      const entry: DoseLogEntry = stamp(
        {
          id: newId(),
          slotId: input.slotId,
          medId: input.medId,
          scheduledInstant: input.scheduledInstant,
          actualInstant: input.actualInstant,
          dose: input.dose,
          unit,
          zone: settings.zone,
          status: 'taken' as const,
          adjusted: normalDose != null && input.dose !== normalDose,
          warnings,
          updatedAt: now,
        },
        now,
      );
      set((s) => ({ doseLog: [...s.doseLog, entry] }));
      persistUpsert('doseLog', entry);

      // Consume any one-time override for this occurrence — it's been fulfilled
      // (Stage 12 FR-12.4), so it must not linger or re-apply.
      const date = isoDateInZone(input.scheduledInstant, settings.zone);
      for (const o of get().doseOverrides) {
        if (o.deleted) continue;
        if (overrideMatchesOccurrence(o, input.slotId, input.medId, input.scheduledInstant, date)) {
          get().clearDoseOverride(o.id);
        }
      }
      return entry;
    },

    takeGroup: (slotId, scheduledInstant) => {
      const { slots, settings } = get();
      const slot = slots.find((s) => s.id === slotId);
      if (!slot) return [];
      const now = Date.now();
      const date = isoDateInZone(scheduledInstant, settings.zone);
      const created: DoseLogEntry[] = [];
      for (const item of slot.items) {
        // Skip items already taken for this occurrence (matched on the occurrence
        // key, so a prior log still counts across a zone change — FR-5.6).
        const exists = get().doseLog.some(
          (e) =>
            !e.deleted &&
            e.status === 'taken' &&
            entryMatchesOccurrence(e, slotId, item.medId, scheduledInstant, date),
        );
        if (exists) continue;
        // Honour a one-time override for this occurrence (Stage 12); logDose then
        // consumes it.
        const override = get().doseOverrides.find(
          (o) =>
            !o.deleted && overrideMatchesOccurrence(o, slotId, item.medId, scheduledInstant, date),
        );
        created.push(
          get().logDose({
            slotId,
            medId: item.medId,
            scheduledInstant,
            dose: override ? override.dose : item.dose,
            actualInstant: now,
          }),
        );
      }
      return created;
    },

    deleteLogEntry: (id) => {
      const now = Date.now();
      let tombstoned: DoseLogEntry | undefined;
      set((s) => ({
        doseLog: s.doseLog.map((e) => {
          if (e.id !== id) return e;
          tombstoned = stamp({ ...e, deleted: true }, now);
          return tombstoned;
        }),
      }));
      if (tombstoned) persistUpsert('doseLog', tombstoned);
    },

    // Re-time an already-logged dose (calendar drag, Stage 13) — delegates to
    // `editLogEntry` so the two correction paths (drag vs. edit form, Stage 18
    // FR-18.2) share one guardrail-recheck implementation.
    adjustDoseTime: (id, actualInstant) => get().editLogEntry(id, { actualInstant }),

    // Correct an already-logged dose's amount and/or time (Stage 18 FR-18.2).
    // This is a correction of the record, not a regimen change: it never
    // originates a dose (the caller supplies both fields), and — unlike
    // `updateMedication`/`updateSlot` — it deliberately does NOT call
    // `recordChange`; Stage 16 markers describe changes to the *regimen*, not
    // fixes to what was recorded about a single past dose.
    editLogEntry: (id, patch) => {
      const { doseLog, slots, medications, settings } = get();
      const entry = doseLog.find((e) => e.id === id);
      if (!entry || entry.deleted) return undefined;
      const now = Date.now();
      const med = medications.find((m) => m.id === entry.medId);
      const dose = patch.dose ?? entry.dose;
      const actualInstant = patch.actualInstant ?? entry.actualInstant;
      // Re-validate against the shared guardrails, excluding this entry from the
      // prior-dose history so an edit never counts against itself.
      const others = doseLog.filter((e) => e.id !== id);
      const warnings = med
        ? checkGuardrails(med, dose, actualInstant, others, settings.zone)
        : entry.warnings;
      const normalDose = scheduledDoseFor(slots, entry.slotId, entry.medId);
      const adjusted = normalDose != null && dose !== normalDose;
      let updated: DoseLogEntry | undefined;
      set((s) => ({
        doseLog: s.doseLog.map((e) => {
          if (e.id !== id) return e;
          updated = stamp({ ...e, dose, actualInstant, warnings, adjusted }, now);
          return updated;
        }),
      }));
      if (updated) persistUpsert('doseLog', updated);
      return updated;
    },

    setDoseOverride: (input) => {
      const { doseOverrides, settings } = get();
      const now = Date.now();
      const date = isoDateInZone(input.scheduledInstant, settings.zone);
      // Reuse an existing (non-deleted) override for the same occurrence so a repeat
      // adjustment updates in place rather than stacking duplicates.
      const existing = doseOverrides.find(
        (o) =>
          !o.deleted &&
          overrideMatchesOccurrence(o, input.slotId, input.medId, input.scheduledInstant, date),
      );
      const override: DoseOverride = stamp(
        {
          id: existing?.id ?? newId(),
          slotId: input.slotId,
          medId: input.medId,
          scheduledInstant: input.scheduledInstant,
          zone: settings.zone,
          dose: input.dose,
          note: input.note,
          updatedAt: now,
          version: existing?.version,
        },
        now,
      );
      set((s) => ({
        doseOverrides: existing
          ? s.doseOverrides.map((o) => (o.id === override.id ? override : o))
          : [...s.doseOverrides, override],
      }));
      persistUpsert('doseOverrides', override);
      return override;
    },

    clearDoseOverride: (id) => {
      const now = Date.now();
      let tombstoned: DoseOverride | undefined;
      set((s) => ({
        doseOverrides: s.doseOverrides.map((o) => {
          if (o.id !== id) return o;
          tombstoned = stamp({ ...o, deleted: true }, now);
          return tombstoned;
        }),
      }));
      if (tombstoned) persistUpsert('doseOverrides', tombstoned);
    },

    // ---- Health-condition event tracking (Stage 13) ---------------------------

    addEventType: (input) => {
      const now = Date.now();
      const type: EventType = stamp({ id: newId(), updatedAt: now, ...input }, now);
      set((s) => ({ eventTypes: [...s.eventTypes, type] }));
      persistUpsert('eventTypes', type);
      return type;
    },

    updateEventType: (id, patch) => {
      const now = Date.now();
      let updated: EventType | undefined;
      set((s) => ({
        eventTypes: s.eventTypes.map((t) => {
          if (t.id !== id) return t;
          updated = stamp({ ...t, ...patch }, now);
          return updated;
        }),
      }));
      if (updated) persistUpsert('eventTypes', updated);
    },

    setEventTypeArchived: (id, archived) => {
      // Event types are never deleted — archiving hides a type from the active
      // picker while preserving its definition so past instances still resolve
      // (FR-13.6). The flag rides in the synced payload and is reversible.
      const now = Date.now();
      let updated: EventType | undefined;
      set((s) => ({
        eventTypes: s.eventTypes.map((t) => {
          if (t.id !== id) return t;
          updated = stamp({ ...t, archived }, now);
          return updated;
        }),
      }));
      if (updated) persistUpsert('eventTypes', updated);
    },

    logEvent: (input) => {
      const now = Date.now();
      const { settings } = get();
      const instance: EventInstance = stamp(
        {
          id: newId(),
          typeId: input.typeId,
          occurredAt: input.occurredAt,
          zone: settings.zone,
          values: input.values,
          note: input.note,
          updatedAt: now,
        },
        now,
      );
      set((s) => ({ eventInstances: [...s.eventInstances, instance] }));
      persistUpsert('eventInstances', instance);
      return instance;
    },

    updateEventInstance: (id, patch) => {
      const now = Date.now();
      let updated: EventInstance | undefined;
      set((s) => ({
        eventInstances: s.eventInstances.map((e) => {
          if (e.id !== id) return e;
          updated = stamp({ ...e, ...patch }, now);
          return updated;
        }),
      }));
      if (updated) persistUpsert('eventInstances', updated);
    },

    deleteEventInstance: (id) => {
      const now = Date.now();
      let tombstoned: EventInstance | undefined;
      set((s) => ({
        eventInstances: s.eventInstances.map((e) => {
          if (e.id !== id) return e;
          tombstoned = stamp({ ...e, deleted: true }, now);
          return tombstoned;
        }),
      }));
      if (tombstoned) persistUpsert('eventInstances', tombstoned);
    },

    updateSettings: (patch) => {
      const now = Date.now();
      const next = stamp({ ...get().settings, ...patch }, now);
      set({ settings: next });
      persistSettings(next);
    },

    addChangeNote: (id, note) => {
      const now = Date.now();
      let updated: RegimenChange | undefined;
      set((s) => ({
        regimenChanges: s.regimenChanges.map((c) => {
          if (c.id !== id) return c;
          // `changedAt` is the event time and stays put; only sync metadata moves.
          updated = stamp({ ...c, note }, now);
          return updated;
        }),
      }));
      if (updated) persistUpsert('regimenChanges', updated);
    },

    deleteChange: (id) => {
      const now = Date.now();
      let tombstoned: RegimenChange | undefined;
      set((s) => ({
        regimenChanges: s.regimenChanges.map((c) => {
          if (c.id !== id) return c;
          tombstoned = stamp({ ...c, deleted: true }, now);
          return tombstoned;
        }),
      }));
      if (tombstoned) persistUpsert('regimenChanges', tombstoned);
    },

    importData: (incoming, mode) => {
      const {
        medications,
        slots,
        doseLog,
        doseOverrides,
        eventTypes,
        eventInstances,
        regimenChanges,
        scheduleSnapshots,
        settings,
      } = get();
      const merged = mergeDatasets(
        {
          medications,
          slots,
          doseLog,
          doseOverrides,
          eventTypes,
          eventInstances,
          regimenChanges,
          scheduleSnapshots,
          settings,
        },
        incoming,
        mode,
      );
      set({ ...merged });
      // Persist (and queue for sync) every record so the import propagates.
      for (const m of merged.medications) persistUpsert('medications', m);
      for (const s of merged.slots) persistUpsert('slots', s);
      for (const e of merged.doseLog) persistUpsert('doseLog', e);
      for (const o of merged.doseOverrides) persistUpsert('doseOverrides', o);
      for (const t of merged.eventTypes) persistUpsert('eventTypes', t);
      for (const e of merged.eventInstances) persistUpsert('eventInstances', e);
      for (const c of merged.regimenChanges) persistUpsert('regimenChanges', c);
      for (const s of merged.scheduleSnapshots) persistUpsert('scheduleSnapshots', s);
      persistSettings(merged.settings);
    },
  };
});
