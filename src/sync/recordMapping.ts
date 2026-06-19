// Mapping between local domain entities and the wire `SyncRecord` envelope.
//
// Local tables store domain entities (Medication/Slot/DoseLogEntry/Settings) with
// `id`/`updatedAt`/`version`/`deleted` at the top level. A `SyncRecord` lifts
// those into an envelope and carries the remaining fields as a readable, typed
// `payload` (Stage 4). This module is the single converter so the store, the
// repository outbox, and the merge step agree on the shape.

import type { RecordType, SyncRecord } from '../core/cloudRecord';
import type { Settings } from '../core/types';
import type { TableName } from '../store/repository';

/** The settings singleton has no natural id; it syncs under this fixed one. */
export const SETTINGS_RECORD_ID = 'settings';
/** Local id of the settings row in the settings table (see LocalRepository). */
export const SETTINGS_ROW_ID = 'app';

const TYPE_FOR_TABLE: Record<TableName, RecordType> = {
  medications: 'medication',
  slots: 'slot',
  doseLog: 'doseLog',
  doseOverrides: 'doseOverride',
  eventTypes: 'eventType',
  eventInstances: 'eventInstance',
  settings: 'settings',
};

const TABLE_FOR_TYPE: Record<RecordType, TableName> = {
  medication: 'medications',
  slot: 'slots',
  doseLog: 'doseLog',
  doseOverride: 'doseOverrides',
  eventType: 'eventTypes',
  eventInstance: 'eventInstances',
  settings: 'settings',
};

export function tableForType(type: RecordType): TableName {
  return TABLE_FOR_TYPE[type];
}

/** Envelope fields that live at the top level, not inside `payload`. */
const ENVELOPE_KEYS = ['id', 'updatedAt', 'version', 'deleted'] as const;

type StoredEntity = { id: string; updatedAt: number; version?: number; deleted?: boolean } & Record<
  string,
  unknown
>;

/**
 * Wrap a stored entity as a `SyncRecord`. Settings are special-cased: they carry
 * no `id`/`deleted` of their own, so we mint the fixed settings id and a payload
 * of just the syncable settings fields.
 */
export function toSyncRecord(table: TableName, entity: StoredEntity): SyncRecord {
  const type = TYPE_FOR_TABLE[table];
  const version = entity.version ?? 1;

  if (type === 'settings') {
    const s = entity as unknown as Settings;
    return {
      id: SETTINGS_RECORD_ID,
      type,
      updatedAt: s.updatedAt,
      version,
      payload: {
        zone: s.zone,
        adherenceWindowDays: s.adherenceWindowDays,
        missedDayThreshold: s.missedDayThreshold,
      },
    };
  }

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entity)) {
    if ((ENVELOPE_KEYS as readonly string[]).includes(k)) continue;
    payload[k] = v;
  }
  return {
    id: entity.id,
    type,
    updatedAt: entity.updatedAt,
    version,
    payload,
    ...(entity.deleted ? { deleted: true } : {}),
  };
}

export interface MappedEntity {
  table: TableName;
  entity: StoredEntity;
}

/**
 * Reconstruct a stored entity from a `SyncRecord`. The envelope is authoritative
 * for id/updatedAt/version/deleted; the payload supplies the rest. Settings are
 * rebuilt under their fixed local row id.
 */
export function fromSyncRecord(rec: SyncRecord): MappedEntity {
  const table = TABLE_FOR_TYPE[rec.type];

  if (rec.type === 'settings') {
    const p = rec.payload as Record<string, unknown>;
    return {
      table,
      entity: {
        id: SETTINGS_ROW_ID,
        zone: p.zone,
        adherenceWindowDays: p.adherenceWindowDays,
        missedDayThreshold: p.missedDayThreshold,
        updatedAt: rec.updatedAt,
        version: rec.version,
      } as StoredEntity,
    };
  }

  return {
    table,
    entity: {
      ...(rec.payload as Record<string, unknown>),
      id: rec.id,
      updatedAt: rec.updatedAt,
      version: rec.version,
      ...(rec.deleted ? { deleted: true } : {}),
    } as StoredEntity,
  };
}
