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
import {
  eventInstance,
  eventType,
  med,
  regimenChange,
  settings,
  slot,
  logEntry,
  override,
} from '../test/fixtures';

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
      ['eventTypes', eventType({ id: 'et' })],
      ['eventInstances', eventInstance({ id: 'ei', typeId: 'et' })],
      ['regimenChanges', regimenChange({ id: 'rc', slotId: 's' })],
    ] as const) {
      expect(validateSyncRecord(wrap(table, entity)).ok).toBe(true);
    }
  });

  it('round-trips a regimen change through the wire envelope', () => {
    const c = regimenChange({ id: 'rc1', slotId: 's1', updatedAt: 7, version: 2 });
    const rec = wrap('regimenChanges', c);
    expect(rec).toMatchObject({ id: 'rc1', type: 'regimenChange', updatedAt: 7, version: 2 });
    const { table, entity } = fromSyncRecord(rec);
    expect(table).toBe('regimenChanges');
    expect(entity).toMatchObject({ id: 'rc1', slotId: 's1', kind: 'slot-updated' });
  });

  // Stage 18 FR-18.1 — the structured machine layer must survive the wire
  // unaltered (typed values must not be stringified) and must validate.
  it('round-trips a structured regimen-change diff without flattening its values', () => {
    const c = regimenChange({
      id: 'rc2',
      slotId: 's1',
      kind: 'medication-retired',
      changes: [
        {
          field: 'Status',
          from: 'Active',
          to: 'Retired',
          key: 'med.active',
          medId: 'm1',
          fromValue: true,
          toValue: false,
        },
        {
          field: '08:00 Morning: Lamotrigine dose',
          from: '150mg',
          to: null,
          key: 'slot.dose',
          medId: 'm1',
          slotId: 's1',
          fromValue: 150,
          toValue: null,
        },
      ],
    });
    const rec = wrap('regimenChanges', c);
    expect(validateSyncRecord(rec).ok).toBe(true);
    const { entity } = fromSyncRecord(rec);
    expect(entity.changes).toEqual(c.changes);
  });

  it('round-trips an event type and instance through the wire envelope', () => {
    const t = eventType({ id: 'et1', name: 'Seizure', updatedAt: 5, version: 2 });
    const tRec = wrap('eventTypes', t);
    expect(tRec).toMatchObject({ id: 'et1', type: 'eventType', updatedAt: 5, version: 2 });
    expect(fromSyncRecord(tRec)).toMatchObject({
      table: 'eventTypes',
      entity: { id: 'et1', name: 'Seizure' },
    });

    const i = eventInstance({ id: 'ei1', typeId: 'et1', values: { severity: 4 }, version: 3 });
    const iRec = wrap('eventInstances', i);
    expect(iRec).toMatchObject({ id: 'ei1', type: 'eventInstance', version: 3 });
    expect(fromSyncRecord(iRec)).toMatchObject({
      table: 'eventInstances',
      entity: { id: 'ei1', typeId: 'et1', values: { severity: 4 } },
    });
  });

  // Stage 24 (FR-24.6, P0 #5) — occurrence-linked side-effect attribution
  // must ride the generic mapping unchanged: toSyncRecord spreads every
  // remaining entity key into payload, and fromSyncRecord spreads payload
  // back onto the entity. This proves that holds for the three new fields,
  // including their *absence* — a pre-Stage-24 (unattributed) instance/type
  // must not come back with an explicit `medId`/`category` key it never had.
  it('round-trips an attributed eventInstance and a categorised eventType (FR-24.6)', () => {
    const i = eventInstance({
      id: 'ei-attr',
      typeId: 'et1',
      values: { severity: 2 },
      medId: 'm1',
      doseLogEntryId: 'l1',
      version: 1,
    });
    const iRec = wrap('eventInstances', i);
    expect(iRec.payload).toMatchObject({ medId: 'm1', doseLogEntryId: 'l1' });

    const { entity } = fromSyncRecord(iRec);
    expect(entity).toMatchObject({ medId: 'm1', doseLogEntryId: 'l1' });

    const t = eventType({ id: 'et-cat', name: 'Nausea', category: 'side-effect', version: 1 });
    const tRec = wrap('eventTypes', t);
    expect(tRec.payload).toMatchObject({ category: 'side-effect' });
    expect(fromSyncRecord(tRec).entity).toMatchObject({ category: 'side-effect' });
  });

  // The dishonest version of this test would use toEqual/toMatchObject with
  // `medId: undefined`, which passes whether the key is present-but-undefined
  // or absent entirely. Assert on key presence directly so the claim "absence
  // survives the round trip" is actually checked, not just value equality.
  it('preserves the absence of medId/doseLogEntryId/category through the wire, not just undefined values', () => {
    const i = eventInstance({ id: 'ei-plain', typeId: 'et1', values: {}, version: 1 });
    expect('medId' in i).toBe(true); // the fixture always sets the key, to undefined
    expect(i.medId).toBeUndefined();

    const iRec = wrap('eventInstances', i);
    // toSyncRecord spreads every remaining entity key, `undefined` value and
    // all — so it is faithful to what fromSyncRecord/JSON.stringify will do.
    expect('medId' in iRec.payload).toBe(true);
    expect((iRec.payload as Record<string, unknown>).medId).toBeUndefined();

    // The wire format is JSON: `JSON.stringify` drops keys whose value is
    // `undefined`, so what actually crosses the network never carries the
    // key at all. Round-trip through real JSON (not just the in-memory
    // object) to prove the key is truly gone on the far side.
    const wireRec = JSON.parse(JSON.stringify(iRec));
    expect('medId' in wireRec.payload).toBe(false);
    expect('doseLogEntryId' in wireRec.payload).toBe(false);

    const { entity } = fromSyncRecord(wireRec);
    expect('medId' in entity).toBe(false);
    expect('doseLogEntryId' in entity).toBe(false);

    const t = eventType({ id: 'et-plain', name: 'Seizure', version: 1 });
    expect('category' in t).toBe(true);
    expect(t.category).toBeUndefined();
    const tRec = wrap('eventTypes', t);
    const wireTRec = JSON.parse(JSON.stringify(tRec));
    expect('category' in wireTRec.payload).toBe(false);
    expect('category' in fromSyncRecord(wireTRec).entity).toBe(false);
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
    expect(tableForType('eventType')).toBe('eventTypes');
    expect(tableForType('eventInstance')).toBe('eventInstances');
    expect(tableForType('regimenChange')).toBe('regimenChanges');
    expect(tableForType('settings')).toBe('settings');
  });
});
