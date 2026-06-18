import { create } from 'zustand';
import {
  checkGuardrails,
  entryMatchesOccurrence,
  isoDateInZone,
  newId,
  overrideMatchesOccurrence,
  type DoseLogEntry,
  type DoseOverride,
  type Guardrails,
  type Instant,
  type Medication,
  type ScheduleItem,
  type Settings,
  type Slot,
} from '../core';
import { getRepository, type TableName } from './repository';
import { seedDataset } from './seed';
import { mergeDatasets, type ImportMode } from './transfer';
import type { Dataset } from '../core/types';

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

interface StoreState {
  hydrated: boolean;
  medications: Medication[];
  slots: Slot[];
  doseLog: DoseLogEntry[];
  doseOverrides: DoseOverride[];
  settings: Settings;

  hydrate: () => Promise<void>;
  /** Re-read the repository into memory after a sync applied remote changes. */
  reload: () => Promise<void>;

  addMedication: (input: MedicationInput) => Medication;
  updateMedication: (id: string, patch: Partial<MedicationInput>) => void;
  deleteMedication: (id: string) => void;

  addSlot: (input: SlotInput) => Slot;
  updateSlot: (id: string, patch: Partial<SlotInput>) => void;
  deleteSlot: (id: string) => void;

  logDose: (input: LogDoseInput) => DoseLogEntry;
  takeGroup: (slotId: string, scheduledInstant: Instant) => DoseLogEntry[];
  deleteLogEntry: (id: string) => void;

  /** Set/replace a one-time override of a future occurrence's dose (Stage 12). */
  setDoseOverride: (input: DoseOverrideInput) => DoseOverride;
  clearDoseOverride: (id: string) => void;

  updateSettings: (patch: Partial<Omit<Settings, 'updatedAt' | 'version'>>) => void;

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

export const useStore = create<StoreState>((set, get) => ({
  hydrated: false,
  medications: [],
  slots: [],
  doseLog: [],
  doseOverrides: [],
  settings: {
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London',
    adherenceWindowDays: 7,
    missedDayThreshold: 3,
    updatedAt: 0,
  },

  hydrate: async () => {
    const repo = getRepository();
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
    persistSettings(data.settings);
  },

  reload: async () => {
    const loaded = await getRepository().loadAll();
    if (loaded) set({ ...loaded });
  },

  addMedication: (input) => {
    const now = Date.now();
    const med: Medication = stamp({ id: newId(), updatedAt: now, ...input }, now);
    set((s) => ({ medications: [...s.medications, med] }));
    persistUpsert('medications', med);
    return med;
  },

  updateMedication: (id, patch) => {
    const now = Date.now();
    let updated: Medication | undefined;
    set((s) => ({
      medications: s.medications.map((m) => {
        if (m.id !== id) return m;
        updated = stamp({ ...m, ...patch }, now);
        return updated;
      }),
    }));
    if (updated) persistUpsert('medications', updated);
  },

  deleteMedication: (id) => {
    const now = Date.now();
    let tombstoned: Medication | undefined;
    const affectedSlots: Slot[] = [];
    set((s) => {
      const medications = s.medications.map((m) => {
        if (m.id !== id) return m;
        tombstoned = stamp({ ...m, deleted: true }, now);
        return tombstoned;
      });
      // FR-MED-4: remove the med from every slot; tombstone now-empty slots.
      const slots = s.slots.map((slot) => {
        if (slot.deleted || !slot.items.some((i) => i.medId === id)) return slot;
        const items = slot.items.filter((i) => i.medId !== id);
        const next = stamp(
          items.length === 0 ? { ...slot, items, deleted: true } : { ...slot, items },
          now,
        );
        affectedSlots.push(next);
        return next;
      });
      return { medications, slots };
    });
    if (tombstoned) persistUpsert('medications', tombstoned);
    for (const slot of affectedSlots) persistUpsert('slots', slot);
  },

  addSlot: (input) => {
    const now = Date.now();
    const slot: Slot = stamp({ id: newId(), updatedAt: now, ...input }, now);
    set((s) => ({ slots: [...s.slots, slot] }));
    persistUpsert('slots', slot);
    return slot;
  },

  updateSlot: (id, patch) => {
    const now = Date.now();
    let updated: Slot | undefined;
    set((s) => ({
      slots: s.slots.map((slot) => {
        if (slot.id !== id) return slot;
        updated = stamp({ ...slot, ...patch }, now);
        return updated;
      }),
    }));
    if (updated) persistUpsert('slots', updated);
  },

  deleteSlot: (id) => {
    const now = Date.now();
    let tombstoned: Slot | undefined;
    set((s) => ({
      slots: s.slots.map((slot) => {
        if (slot.id !== id) return slot;
        tombstoned = stamp({ ...slot, deleted: true }, now);
        return tombstoned;
      }),
    }));
    if (tombstoned) persistUpsert('slots', tombstoned);
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

  updateSettings: (patch) => {
    const now = Date.now();
    const next = stamp({ ...get().settings, ...patch }, now);
    set({ settings: next });
    persistSettings(next);
  },

  importData: (incoming, mode) => {
    const { medications, slots, doseLog, doseOverrides, settings } = get();
    const merged = mergeDatasets(
      { medications, slots, doseLog, doseOverrides, settings },
      incoming,
      mode,
    );
    set({ ...merged });
    // Persist (and queue for sync) every record so the import propagates.
    for (const m of merged.medications) persistUpsert('medications', m);
    for (const s of merged.slots) persistUpsert('slots', s);
    for (const e of merged.doseLog) persistUpsert('doseLog', e);
    for (const o of merged.doseOverrides) persistUpsert('doseOverrides', o);
    persistSettings(merged.settings);
  },
}));
