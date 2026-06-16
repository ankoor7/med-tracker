import { describe, expect, it } from 'vitest';
import {
  MAX_RECORD_BYTES,
  validateSyncRecord,
  type RecordType,
  type SyncRecord,
} from './cloudRecord';

const record = (over: Partial<SyncRecord> = {}): unknown => ({
  id: 'r1',
  type: 'medication' as RecordType,
  updatedAt: 1000,
  version: 1,
  payload: {
    id: 'r1',
    name: 'Levothyroxine',
    unit: 'mcg',
    halfLifeHours: 168,
    active: true,
    guardrails: { maxSingleDose: 200, maxDailyDose: null, minIntervalHours: null },
  },
  ...over,
});

describe('validateSyncRecord — envelope', () => {
  it('accepts a well-formed typed record', () => {
    expect(validateSyncRecord(record())).toEqual({ ok: true });
  });

  it('rejects a non-object', () => {
    expect(validateSyncRecord('nope')).toMatchObject({ ok: false });
  });

  it('rejects a missing id', () => {
    expect(validateSyncRecord(record({ id: '' }))).toMatchObject({ ok: false, reason: /id/ });
  });

  it('rejects an unknown type', () => {
    const res = validateSyncRecord({ ...(record() as object), type: 'bogus' });
    expect(res).toMatchObject({ ok: false, reason: /unknown type/ });
  });

  it('rejects a non-numeric version', () => {
    expect(validateSyncRecord(record({ version: NaN }))).toMatchObject({ ok: false });
  });

  it('rejects a non-object payload', () => {
    const res = validateSyncRecord({ ...(record() as object), payload: 'ciphertext' });
    expect(res).toMatchObject({ ok: false, reason: /payload/ });
  });

  it('rejects an oversized record', () => {
    const big = 'x'.repeat(MAX_RECORD_BYTES + 1);
    const res = validateSyncRecord(
      record({
        payload: {
          name: 'X',
          unit: 'mg',
          halfLifeHours: 10,
          active: true,
          guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
          notes: big,
        },
      }),
    );
    expect(res).toMatchObject({ ok: false, reason: /too large/ });
  });

  it('accepts a tombstone without deep payload validation', () => {
    expect(validateSyncRecord(record({ deleted: true, payload: {} }))).toEqual({ ok: true });
  });
});

describe('validateSyncRecord — typed payloads', () => {
  it('rejects a medication missing required fields', () => {
    const res = validateSyncRecord(record({ payload: { name: 'X' } }));
    expect(res).toMatchObject({ ok: false });
  });

  it('rejects a guardrails block with a wrong-typed limit', () => {
    const res = validateSyncRecord(
      record({
        payload: {
          name: 'X',
          unit: 'mg',
          halfLifeHours: 10,
          active: true,
          guardrails: { maxSingleDose: 'lots', maxDailyDose: null, minIntervalHours: null },
        },
      }),
    );
    expect(res).toMatchObject({ ok: false, reason: /guardrails/ });
  });

  it('accepts a valid slot', () => {
    const res = validateSyncRecord({
      id: 's1',
      type: 'slot',
      updatedAt: 1,
      version: 1,
      payload: { id: 's1', time: '08:00', items: [{ medId: 'm1', dose: 50 }] },
    });
    expect(res).toEqual({ ok: true });
  });

  it('rejects a slot with a bad time', () => {
    const res = validateSyncRecord({
      id: 's1',
      type: 'slot',
      updatedAt: 1,
      version: 1,
      payload: { id: 's1', time: '8am', items: [{ medId: 'm1', dose: 50 }] },
    });
    expect(res).toMatchObject({ ok: false, reason: /time/ });
  });

  it('rejects a slot with no items', () => {
    const res = validateSyncRecord({
      id: 's1',
      type: 'slot',
      updatedAt: 1,
      version: 1,
      payload: { id: 's1', time: '08:00', items: [] },
    });
    expect(res).toMatchObject({ ok: false, reason: /items/ });
  });

  it('accepts a valid doseLog', () => {
    const res = validateSyncRecord({
      id: 'd1',
      type: 'doseLog',
      updatedAt: 1,
      version: 1,
      payload: {
        id: 'd1',
        slotId: 's1',
        medId: 'm1',
        scheduledInstant: 100,
        actualInstant: 120,
        dose: 50,
        status: 'taken',
      },
    });
    expect(res).toEqual({ ok: true });
  });

  it('rejects a doseLog with an invalid status', () => {
    const res = validateSyncRecord({
      id: 'd1',
      type: 'doseLog',
      updatedAt: 1,
      version: 1,
      payload: {
        id: 'd1',
        slotId: 's1',
        medId: 'm1',
        scheduledInstant: 100,
        actualInstant: 120,
        dose: 50,
        status: 'maybe',
      },
    });
    expect(res).toMatchObject({ ok: false, reason: /status/ });
  });

  it('accepts valid settings', () => {
    const res = validateSyncRecord({
      id: 'settings',
      type: 'settings',
      updatedAt: 1,
      version: 1,
      payload: { zone: 'Europe/London', adherenceWindowDays: 30, missedDayThreshold: 2 },
    });
    expect(res).toEqual({ ok: true });
  });
});
