// Test fixtures — minimal factory helpers for domain entities.
import type {
  DoseLogEntry,
  DoseOverride,
  Guardrails,
  Medication,
  Settings,
  Slot,
} from '../core/types';

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

export function med(over: Partial<Medication> = {}): Medication {
  const guardrails: Guardrails = {
    maxSingleDose: null,
    maxDailyDose: null,
    minIntervalHours: null,
    ...over.guardrails,
  };
  return {
    id: over.id ?? id('med'),
    name: over.name ?? 'Test Med',
    color: over.color ?? '#0f766e',
    unit: over.unit ?? 'mg',
    halfLifeHours: over.halfLifeHours ?? 12,
    adjustWhenLate: over.adjustWhenLate ?? true,
    active: over.active ?? true,
    notes: over.notes,
    guardrails,
    updatedAt: over.updatedAt ?? 0,
    version: over.version,
    deleted: over.deleted,
  };
}

export function slot(over: Partial<Slot> = {}): Slot {
  return {
    id: over.id ?? id('slot'),
    time: over.time ?? '08:00',
    label: over.label,
    items: over.items ?? [],
    updatedAt: over.updatedAt ?? 0,
    version: over.version,
    deleted: over.deleted,
  };
}

export function logEntry(over: Partial<DoseLogEntry> = {}): DoseLogEntry {
  return {
    id: over.id ?? id('log'),
    slotId: over.slotId ?? 'slot-x',
    medId: over.medId ?? 'med-x',
    scheduledInstant: over.scheduledInstant ?? 0,
    actualInstant: over.actualInstant ?? 0,
    dose: over.dose ?? 100,
    unit: over.unit ?? 'mg',
    zone: over.zone ?? 'Europe/London',
    status: over.status ?? 'taken',
    adjusted: over.adjusted ?? false,
    warnings: over.warnings ?? [],
    updatedAt: over.updatedAt ?? 0,
    version: over.version,
    deleted: over.deleted,
  };
}

export function override(over: Partial<DoseOverride> = {}): DoseOverride {
  return {
    id: over.id ?? id('ovr'),
    slotId: over.slotId ?? 'slot-x',
    medId: over.medId ?? 'med-x',
    scheduledInstant: over.scheduledInstant ?? 0,
    zone: over.zone ?? 'Europe/London',
    dose: over.dose ?? 50,
    note: over.note,
    updatedAt: over.updatedAt ?? 0,
    version: over.version,
    deleted: over.deleted,
  };
}

export function settings(over: Partial<Settings> = {}): Settings {
  return {
    zone: over.zone ?? 'Europe/London',
    adherenceWindowDays: over.adherenceWindowDays ?? 7,
    missedDayThreshold: over.missedDayThreshold ?? 2,
    updatedAt: over.updatedAt ?? 0,
    version: over.version,
  };
}
