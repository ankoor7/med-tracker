import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncRecord } from '../core/cloudRecord';

// Mock the singleton client so we can drive the PostgREST chain + rpc directly.
// pull(): from('records').select(...).gt(...).order(...) → { data, error }
// push(): rpc('push_records', { changes })           → { data, error }
const h = vi.hoisted(() => ({ order: vi.fn(), rpc: vi.fn() }));

vi.mock('../supabase/client', () => ({
  getSupabase: () => ({
    from: () => ({ select: () => ({ gt: () => ({ order: h.order }) }) }),
    rpc: h.rpc,
  }),
}));

import { pull, push, SyncError } from './supabaseBackend';

const med = (id: string): SyncRecord => ({
  id,
  type: 'medication',
  updatedAt: 1000,
  version: 1,
  payload: {
    name: 'Lamotrigine',
    unit: 'mg',
    halfLifeHours: 12,
    active: true,
    guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
  },
});

beforeEach(() => {
  h.order.mockReset();
  h.rpc.mockReset();
});

describe('pull', () => {
  it('maps snake_case rows to SyncRecord and computes the token', async () => {
    h.order.mockResolvedValue({
      data: [
        {
          id: 'a',
          type: 'medication',
          updated_at: 1000,
          version: 1,
          deleted: false,
          payload: { name: 'x' },
        },
        { id: 'b', type: 'doseLog', updated_at: 2500, version: 3, deleted: true, payload: {} },
      ],
      error: null,
    });

    const res = await pull(500);

    expect(res.changes).toEqual([
      { id: 'a', type: 'medication', updatedAt: 1000, version: 1, payload: { name: 'x' } },
      { id: 'b', type: 'doseLog', updatedAt: 2500, version: 3, payload: {}, deleted: true },
    ]);
    expect(res.token).toBe(2500);
  });

  it('floors the token at since when no rows return', async () => {
    h.order.mockResolvedValue({ data: [], error: null });
    const res = await pull(900);
    expect(res.changes).toEqual([]);
    expect(res.token).toBe(900);
  });

  it('coerces bigint/integer columns returned as strings', async () => {
    h.order.mockResolvedValue({
      data: [
        {
          id: 'a',
          type: 'slot',
          updated_at: '1700000000000',
          version: '2',
          deleted: false,
          payload: {},
        },
      ],
      error: null,
    });
    const res = await pull(0);
    expect(res.changes[0]).toMatchObject({ updatedAt: 1700000000000, version: 2 });
  });

  it('throws an offline SyncError on a network failure (no error code)', async () => {
    h.order.mockResolvedValue({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '' },
    });
    await expect(pull(0)).rejects.toMatchObject({ name: 'SyncError', offline: true });
  });

  it('throws a non-offline SyncError on a Postgres error (has a code)', async () => {
    h.order.mockResolvedValue({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    });
    await expect(pull(0)).rejects.toMatchObject({ name: 'SyncError', offline: false });
  });
});

describe('push', () => {
  it('sends changes to the push_records RPC and returns the per-id results', async () => {
    h.rpc.mockResolvedValue({
      data: [
        { id: 'a', accepted: true, reason: null },
        { id: 'b', accepted: false, reason: 'stale version' },
      ],
      error: null,
    });
    const changes = [med('a'), med('b')];

    const res = await push(changes);

    expect(h.rpc).toHaveBeenCalledWith('push_records', { changes });
    expect(res.results).toEqual([
      { id: 'a', accepted: true, reason: null },
      { id: 'b', accepted: false, reason: 'stale version' },
    ]);
  });

  it('fast-fails an invalid record before hitting the network', async () => {
    const invalid: SyncRecord = {
      id: 'bad',
      type: 'medication',
      updatedAt: 1,
      version: 1,
      payload: {},
    };
    await expect(push([invalid])).rejects.toBeInstanceOf(SyncError);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
