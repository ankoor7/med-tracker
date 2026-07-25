// Test fixtures — minimal factory helpers for domain entities.
import type {
  DoseLogEntry,
  DoseOverride,
  EventInstance,
  EventType,
  Guardrails,
  Medication,
  RegimenChange,
  ScheduleSnapshot,
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
    strength: over.strength,
    form: over.form,
    guardrails,
    startedAt: over.startedAt,
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

export function eventType(over: Partial<EventType> = {}): EventType {
  return {
    id: over.id ?? id('etype'),
    name: over.name ?? 'Seizure',
    color: over.color ?? '#9333ea',
    properties: over.properties ?? [
      { id: 'severity', name: 'Severity', type: 'scale', min: 1, max: 5 },
      { id: 'duration', name: 'Duration', type: 'duration' },
    ],
    notes: over.notes,
    updatedAt: over.updatedAt ?? 0,
    version: over.version,
    deleted: over.deleted,
  };
}

export function eventInstance(over: Partial<EventInstance> = {}): EventInstance {
  return {
    id: over.id ?? id('einst'),
    typeId: over.typeId ?? 'etype-x',
    occurredAt: over.occurredAt ?? 0,
    zone: over.zone ?? 'Europe/London',
    values: over.values ?? { severity: 3, duration: 90 },
    note: over.note,
    updatedAt: over.updatedAt ?? 0,
    version: over.version,
    deleted: over.deleted,
  };
}

export function regimenChange(over: Partial<RegimenChange> = {}): RegimenChange {
  return {
    id: over.id ?? id('change'),
    changedAt: over.changedAt ?? 0,
    zone: over.zone ?? 'Europe/London',
    kind: over.kind ?? 'slot-updated',
    medId: over.medId,
    slotId: over.slotId,
    summary: over.summary ?? 'Morning: Lamotrigine dose 100mg → 150mg',
    changes: over.changes ?? [{ field: 'Lamotrigine dose', from: '100mg', to: '150mg' }],
    note: over.note,
    updatedAt: over.updatedAt ?? 0,
    version: over.version,
    deleted: over.deleted,
  };
}

export function scheduleSnapshot(over: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot {
  const effectiveFrom = over.effectiveFrom ?? 0;
  return {
    id: over.id ?? id('snap'),
    effectiveFrom,
    zone: over.zone ?? 'Europe/London',
    medications: over.medications ?? [],
    slots: over.slots ?? [],
    updatedAt: over.updatedAt ?? effectiveFrom,
    version: over.version,
    deleted: over.deleted,
  };
}

export function settings(over: Partial<Settings> = {}): Settings {
  return {
    zone: over.zone ?? 'Europe/London',
    adherenceWindowDays: over.adherenceWindowDays ?? 7,
    missedDayThreshold: over.missedDayThreshold ?? 2,
    assumeTakenOnTime: over.assumeTakenOnTime,
    updatedAt: over.updatedAt ?? 0,
    version: over.version,
  };
}
