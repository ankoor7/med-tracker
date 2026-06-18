import { describe, expect, it } from 'vitest';
import {
  SETTINGS_RECORD_ID,
  SETTINGS_ROW_ID,
  fromSyncRecord,
  tableForType,
  toSyncRecord,
} from './recordMapping';
import { validateSyncRecord } from '../core/cloudRecord';
import type { TableName } from '../store/repository';
import { med, settings, slot, logEntry, override } from '../test/fixtures';

// Domain entities lack an index signature; production calls `toSyncRecord` with
// the same `as never` widening. Centralise it so the tests read cleanly.
const wrap = (table: TableName, entity: object) => toSyncRecord(table, entity as never);

describe('record mapping', () => {
  it('round-trips a medication through the wire envelope', () => {
    const m = med({ id: 'a', name: 'Lamotrigine', updatedAt: 1000, version: 3 });
    const rec = wrap('medications', m);
    expect(rec).toMatchObject({ id: 'a', type: 'medication', updatedAt: 1000, version: 3 });
    expect(rec.deleted).toBeUndefined();
    // Envelope fields must not leak into the payload.
    expect(rec.payload).not.toHaveProperty('updatedAt');
    expect(rec.payload).not.toHaveProperty('version');

    const { table, entity } = fromSyncRecord(rec);
    expect(table).toBe('medications');
    expect(entity).toMatchObject({ id: 'a', name: 'Lamotrigine', updatedAt: 1000, version: 3 });
  });

  it('produces a record the shared schema validates', () => {
    for (const [table, entity] of [
      ['medications', med({ id: 'm' })],
      ['slots', slot({ id: 's', items: [{ medId: 'm', dose: 50 }] })],
      ['doseLog', logEntry({ id: 'l', medId: 'm', slotId: 's' })],
      ['doseOverrides', override({ id: 'o', medId: 'm', slotId: 's' })],
    ] as const) {
      expect(validateSyncRecord(wrap(table, entity)).ok).toBe(true);
    }
  });

  it('round-trips a doseOverride through the wire envelope', () => {
    const o = override({ id: 'o1', medId: 'm', slotId: 's', dose: 75, updatedAt: 9, version: 2 });
    const rec = wrap('doseOverrides', o);
    expect(rec).toMatchObject({ id: 'o1', type: 'doseOverride', updatedAt: 9, version: 2 });
    const { table, entity } = fromSyncRecord(rec);
    expect(table).toBe('doseOverrides');
    expect(entity).toMatchObject({ id: 'o1', medId: 'm', slotId: 's', dose: 75 });
  });

  it('defaults a missing version to 1', () => {
    const rec = wrap('medications', med({ id: 'a', version: undefined }));
    expect(rec.version).toBe(1);
  });

  it('carries a tombstone flag both ways', () => {
    const rec = wrap('medications', med({ id: 'a', deleted: true, version: 2 }));
    expect(rec.deleted).toBe(true);
    expect(fromSyncRecord(rec).entity.deleted).toBe(true);
  });

  it('maps settings under the fixed record id and back to the fixed row id', () => {
    const s = settings({ zone: 'America/New_York', updatedAt: 2000, version: 4 });
    const rec = wrap('settings', s);
    expect(rec.id).toBe(SETTINGS_RECORD_ID);
    expect(rec.type).toBe('settings');
    expect(validateSyncRecord(rec).ok).toBe(true);

    const { table, entity } = fromSyncRecord(rec);
    expect(table).toBe('settings');
    expect(entity.id).toBe(SETTINGS_ROW_ID);
    expect(entity).toMatchObject({ zone: 'America/New_York', updatedAt: 2000, version: 4 });
  });

  it('tableForType inverts the type→table mapping', () => {
    expect(tableForType('medication')).toBe('medications');
    expect(tableForType('slot')).toBe('slots');
    expect(tableForType('doseLog')).toBe('doseLog');
    expect(tableForType('settings')).toBe('settings');
  });
});
