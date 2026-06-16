import { describe, expect, it } from 'vitest';
import { BadRequestError, handlePull, handlePush } from './handlerCore';
import { InMemorySyncStore } from './inMemoryStore';
import { MAX_RECORD_BYTES } from '../../src/core/cloudRecord';
import type { SyncRecord } from './types';

// A valid medication record; override per test.
const rec = (over: Partial<SyncRecord> = {}): SyncRecord => ({
  id: over.id ?? 'r1',
  type: over.type ?? 'medication',
  updatedAt: over.updatedAt ?? 1000,
  version: over.version ?? 1,
  payload: over.payload ?? {
    id: over.id ?? 'r1',
    name: 'Levothyroxine',
    unit: 'mcg',
    halfLifeHours: 168,
    active: true,
    guardrails: { maxSingleDose: 200, maxDailyDose: null, minIntervalHours: null },
  },
  ...(over.deleted ? { deleted: true } : {}),
});

describe('handlePush', () => {
  it('accepts new records', async () => {
    const store = new InMemorySyncStore();
    const res = await handlePush(store, 'userA', { changes: [rec({ id: 'a' }), rec({ id: 'b' })] });
    expect(res.results.every((r) => r.accepted)).toBe(true);
  });

  it('rejects a stale (older/equal version) record', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', { changes: [rec({ id: 'a', version: 2 })] });
    const res = await handlePush(store, 'userA', { changes: [rec({ id: 'a', version: 1 })] });
    expect(res.results[0]!.accepted).toBe(false);
    expect(res.results[0]!.reason).toMatch(/stale/i);
  });

  it('accepts a strictly newer version', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', { changes: [rec({ id: 'a', version: 1 })] });
    const res = await handlePush(store, 'userA', { changes: [rec({ id: 'a', version: 2 })] });
    expect(res.results[0]!.accepted).toBe(true);
  });

  it('rejects a record with a missing id without throwing (AC3)', async () => {
    const store = new InMemorySyncStore();
    const res = await handlePush(store, 'userA', { changes: [rec({ id: '' })] });
    expect(res.results[0]!.accepted).toBe(false);
    expect(res.results[0]!.reason).toMatch(/id/i);
  });

  it('rejects an unknown record type (AC3)', async () => {
    const store = new InMemorySyncStore();
    const res = await handlePush(store, 'userA', {
      changes: [{ ...rec({ id: 'x' }), type: 'bogus' as never }],
    });
    expect(res.results[0]!.accepted).toBe(false);
    expect(res.results[0]!.reason).toMatch(/unknown type/i);
  });

  it('rejects an oversized record (AC3)', async () => {
    const store = new InMemorySyncStore();
    const big = rec({ id: 'x' });
    (big.payload as Record<string, unknown>).notes = 'x'.repeat(MAX_RECORD_BYTES + 1);
    const res = await handlePush(store, 'userA', { changes: [big] });
    expect(res.results[0]!.accepted).toBe(false);
    expect(res.results[0]!.reason).toMatch(/too large/i);
  });

  it('throws BadRequest when changes is missing', async () => {
    const store = new InMemorySyncStore();
    await expect(handlePush(store, 'userA', {} as never)).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('handlePull', () => {
  it('returns only records newer than the token, with a new high-water token', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', {
      changes: [
        rec({ id: 'a', updatedAt: 1000 }),
        rec({ id: 'b', updatedAt: 2000 }),
        rec({ id: 'c', updatedAt: 3000 }),
      ],
    });
    const res = await handlePull(store, 'userA', { since: 1500 });
    expect(res.changes.map((e) => e.id)).toEqual(['b', 'c']);
    expect(res.token).toBe(3000);
  });

  it('returns a readable, typed payload (AC1)', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', { changes: [rec({ id: 'a' })] });
    const res = await handlePull(store, 'userA', {});
    const stored = res.changes[0]!;
    expect(stored.type).toBe('medication');
    expect(typeof stored.payload).toBe('object');
    expect((stored.payload as { name: string }).name).toBe('Levothyroxine');
  });

  it('returns everything when no token is given', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', { changes: [rec({ id: 'a', updatedAt: 1000 })] });
    const res = await handlePull(store, 'userA', {});
    expect(res.changes).toHaveLength(1);
    expect(res.token).toBe(1000);
  });

  it('keeps the token stable when there are no changes', async () => {
    const store = new InMemorySyncStore();
    const res = await handlePull(store, 'userA', { since: 500 });
    expect(res.changes).toEqual([]);
    expect(res.token).toBe(500);
  });
});

describe('per-user isolation (AC2)', () => {
  it('one user never sees another user’s records', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', { changes: [rec({ id: 'secretA' })] });
    await handlePush(store, 'userB', { changes: [rec({ id: 'secretB' })] });

    const a = await handlePull(store, 'userA', {});
    const b = await handlePull(store, 'userB', {});
    expect(a.changes.map((e) => e.id)).toEqual(['secretA']);
    expect(b.changes.map((e) => e.id)).toEqual(['secretB']);
  });

  it('a push by A under the same id does not affect B', async () => {
    const store = new InMemorySyncStore();
    const payloadA = {
      id: 'shared',
      name: 'A-med',
      unit: 'mg',
      halfLifeHours: 1,
      active: true,
      guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
    };
    const payloadB = { ...payloadA, name: 'B-med' };
    await handlePush(store, 'userA', {
      changes: [rec({ id: 'shared', version: 1, payload: payloadA })],
    });
    await handlePush(store, 'userB', {
      changes: [rec({ id: 'shared', version: 1, payload: payloadB })],
    });
    const a = await handlePull(store, 'userA', {});
    expect((a.changes[0]!.payload as { name: string }).name).toBe('A-med');
  });
});
