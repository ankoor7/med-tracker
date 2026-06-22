// Data export / import (Stage 7). Round-trippable JSON of the whole dataset, a
// log-focused CSV, and a validated importer that reuses the *same* schema
// validators as sync (core/cloudRecord) and the *same* LWW merge rule, so import
// and sync converge identically.
//
// Lives in the store layer (not core) because it bridges domain entities to the
// wire schema via the sync record mapping. The exported file is plaintext and
// unencrypted — the UI warns before exporting (FR-7.7/AC7).

import { isNewerRecord, validateSyncRecord } from '../core/cloudRecord';
import { formatDateTimeWithZone, formatTimeWithZone } from '../core/time';
import type {
  Appointment,
  Dataset,
  DoseLogEntry,
  DoseOverride,
  EventInstance,
  EventType,
  Medication,
  RegimenChange,
  Settings,
  Slot,
} from '../core/types';
import { toSyncRecord } from '../sync/recordMapping';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import type { TableName } from './repository';

export const EXPORT_APP_TAG = 'steadydose';

export interface ExportFile {
  app: typeof EXPORT_APP_TAG;
  schemaVersion: number;
  exportedAt: number;
  data: Dataset;
}

export type ImportMode = 'replace' | 'merge';

export type ImportResult = { ok: true; data: Dataset } | { ok: false; reason: string };

/** Wrap a dataset in the versioned export envelope. */
export function buildExport(data: Dataset, now: number = Date.now()): ExportFile {
  return { app: EXPORT_APP_TAG, schemaVersion: CURRENT_SCHEMA_VERSION, exportedAt: now, data };
}

export function exportJSON(data: Dataset, now?: number): string {
  return JSON.stringify(buildExport(data, now), null, 2);
}

// ---- Import ------------------------------------------------------------------

function validateEntities(table: TableName, entities: { id: string }[]): string | null {
  for (const entity of entities) {
    const result = validateSyncRecord(toSyncRecord(table, entity as never));
    if (!result.ok) return `${table} "${entity.id}": ${result.reason}`;
  }
  return null;
}

/**
 * Parse and validate an exported JSON file. Every record is checked against the
 * shared schema before anything is accepted, so a malformed file is rejected
 * with a reason rather than partially applied.
 */
export function parseImport(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'Not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object')
    return { ok: false, reason: 'Empty or malformed file.' };

  const file = parsed as Partial<ExportFile>;
  if (file.app !== EXPORT_APP_TAG) return { ok: false, reason: 'Not a SteadyDose export.' };
  const data = file.data;
  if (!data || typeof data !== 'object') return { ok: false, reason: 'Missing data section.' };
  const { medications, slots, doseLog, settings } = data as Partial<Dataset>;
  if (!Array.isArray(medications) || !Array.isArray(slots) || !Array.isArray(doseLog)) {
    return { ok: false, reason: 'Missing medications, slots, or dose log.' };
  }
  if (!settings || typeof settings !== 'object') return { ok: false, reason: 'Missing settings.' };
  // doseOverrides / eventTypes / eventInstances / regimenChanges / appointments are
  // newer than older exports; default each to none for back-compat.
  const optional = <K extends keyof Dataset>(key: K): Dataset[K] | [] => {
    const value = (data as Partial<Dataset>)[key];
    return Array.isArray(value) ? (value as Dataset[K]) : [];
  };
  const doseOverrides = optional('doseOverrides');
  const eventTypes = optional('eventTypes');
  const eventInstances = optional('eventInstances');
  const regimenChanges = optional('regimenChanges');
  const appointments = optional('appointments');

  const groups: [TableName, { id: string }[]][] = [
    ['medications', medications],
    ['slots', slots],
    ['doseLog', doseLog],
    ['doseOverrides', doseOverrides],
    ['eventTypes', eventTypes],
    ['eventInstances', eventInstances],
    ['regimenChanges', regimenChanges],
    ['appointments', appointments],
    ['settings', [{ ...(settings as Settings), id: 'settings' }]],
  ];
  for (const [table, entities] of groups) {
    const error = validateEntities(table, entities);
    if (error) return { ok: false, reason: error };
  }

  return {
    ok: true,
    data: {
      medications,
      slots,
      doseLog,
      doseOverrides,
      eventTypes,
      eventInstances,
      regimenChanges,
      appointments,
      settings: settings as Settings,
    },
  };
}

// ---- Merge -------------------------------------------------------------------

function mergeById<T extends { id: string; updatedAt: number; version?: number }>(
  base: T[],
  incoming: T[],
): T[] {
  const byId = new Map(base.map((r) => [r.id, r]));
  for (const rec of incoming) {
    const existing = byId.get(rec.id);
    const order = (r: T) => ({ updatedAt: r.updatedAt, version: r.version ?? 1 });
    if (!existing || isNewerRecord(order(rec), order(existing))) byId.set(rec.id, rec);
  }
  return [...byId.values()];
}

/**
 * Combine an imported dataset with the current one. `replace` takes the import
 * wholesale; `merge` unions per record id, keeping the last-write-wins winner
 * (the same rule sync uses), including the settings singleton.
 */
export function mergeDatasets(base: Dataset, incoming: Dataset, mode: ImportMode): Dataset {
  if (mode === 'replace') return incoming;
  const settings = isNewerRecord(
    { updatedAt: incoming.settings.updatedAt, version: incoming.settings.version ?? 1 },
    { updatedAt: base.settings.updatedAt, version: base.settings.version ?? 1 },
  )
    ? incoming.settings
    : base.settings;
  return {
    medications: mergeById<Medication>(base.medications, incoming.medications),
    slots: mergeById<Slot>(base.slots, incoming.slots),
    doseLog: mergeById<DoseLogEntry>(base.doseLog, incoming.doseLog),
    doseOverrides: mergeById<DoseOverride>(base.doseOverrides, incoming.doseOverrides),
    eventTypes: mergeById<EventType>(base.eventTypes, incoming.eventTypes),
    eventInstances: mergeById<EventInstance>(base.eventInstances, incoming.eventInstances),
    regimenChanges: mergeById<RegimenChange>(base.regimenChanges, incoming.regimenChanges),
    appointments: mergeById<Appointment>(base.appointments, incoming.appointments),
    settings,
  };
}

// ---- CSV ---------------------------------------------------------------------

const CSV_HEADER = [
  'id',
  'medication',
  'scheduled',
  'actual',
  'zone',
  'dose',
  'unit',
  'status',
  'adjusted',
  'late',
  'overCap',
  'warnings',
] as const;

function csvCell(value: string | number | boolean): string {
  const s = String(value);
  // Quote when the value contains a comma, quote, or newline; escape quotes.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flatten the dose log to a spreadsheet-friendly CSV (FR-7.4). */
export function exportCSV(data: Dataset): string {
  const medById = new Map(data.medications.map((m) => [m.id, m]));
  const rows = data.doseLog
    .filter((e) => !e.deleted)
    .sort((a, b) => b.actualInstant - a.actualInstant)
    .map((e) => {
      const med = medById.get(e.medId);
      const late = e.actualInstant > e.scheduledInstant + 60_000;
      return [
        e.id,
        med?.name ?? e.medId,
        formatTimeWithZone(e.scheduledInstant, e.zone),
        formatDateTimeWithZone(e.actualInstant, e.zone),
        e.zone,
        e.dose,
        e.unit,
        e.status,
        e.adjusted,
        late,
        e.warnings.length > 0,
        e.warnings.join('; '),
      ].map(csvCell);
    });
  return [CSV_HEADER.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
