import { describe, expect, it } from 'vitest';
import { BadRequestError, handlePull, handlePush } from './handlerCore';
import { InMemorySyncStore } from './inMemoryStore';
import type { Envelope } from './types';

const env = (over: Partial<Envelope> = {}): Envelope => ({
  id: over.id ?? 'r1',
  updatedAt: over.updatedAt ?? 1000,
  version: over.version ?? 1,
  ciphertext: over.ciphertext ?? 'cipher',
  ...(over.deleted ? { deleted: true } : {}),
});

describe('handlePush', () => {
  it('accepts new envelopes', async () => {
    const store = new InMemorySyncStore();
    const res = await handlePush(store, 'userA', { changes: [env({ id: 'a' }), env({ id: 'b' })] });
    expect(res.results.every((r) => r.accepted)).toBe(true);
  });

  it('rejects a stale (older/equal version) envelope', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', { changes: [env({ id: 'a', version: 2 })] });
    const res = await handlePush(store, 'userA', { changes: [env({ id: 'a', version: 1 })] });
    expect(res.results[0]!.accepted).toBe(false);
    expect(res.results[0]!.reason).toMatch(/stale/i);
  });

  it('accepts a strictly newer version', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', { changes: [env({ id: 'a', version: 1 })] });
    const res = await handlePush(store, 'userA', { changes: [env({ id: 'a', version: 2 })] });
    expect(res.results[0]!.accepted).toBe(true);
  });

  it('flags invalid envelopes without throwing', async () => {
    const store = new InMemorySyncStore();
    const res = await handlePush(store, 'userA', {
      changes: [{ id: '', updatedAt: 1, version: 1, ciphertext: 'x' }],
    });
    expect(res.results[0]!.accepted).toBe(false);
    expect(res.results[0]!.reason).toMatch(/id/i);
  });

  it('throws BadRequest when changes is missing', async () => {
    const store = new InMemorySyncStore();
    await expect(handlePush(store, 'userA', {} as never)).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('handlePull', () => {
  it('returns only envelopes newer than the token, with a new high-water token', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', {
      changes: [
        env({ id: 'a', updatedAt: 1000 }),
        env({ id: 'b', updatedAt: 2000 }),
        env({ id: 'c', updatedAt: 3000 }),
      ],
    });
    const res = await handlePull(store, 'userA', { since: 1500 });
    expect(res.changes.map((e) => e.id)).toEqual(['b', 'c']);
    expect(res.token).toBe(3000);
  });

  it('returns everything when no token is given', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', { changes: [env({ id: 'a', updatedAt: 1000 })] });
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

describe('per-user isolation (AC3)', () => {
  it('one user never sees another user’s envelopes', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', { changes: [env({ id: 'secretA', ciphertext: 'A' })] });
    await handlePush(store, 'userB', { changes: [env({ id: 'secretB', ciphertext: 'B' })] });

    const a = await handlePull(store, 'userA', {});
    const b = await handlePull(store, 'userB', {});
    expect(a.changes.map((e) => e.id)).toEqual(['secretA']);
    expect(b.changes.map((e) => e.id)).toEqual(['secretB']);
  });

  it('a push by A under the same id does not affect B (AC4 round-trip)', async () => {
    const store = new InMemorySyncStore();
    await handlePush(store, 'userA', {
      changes: [env({ id: 'shared', version: 1, ciphertext: 'A' })],
    });
    await handlePush(store, 'userB', {
      changes: [env({ id: 'shared', version: 1, ciphertext: 'B' })],
    });
    const a = await handlePull(store, 'userA', {});
    expect(a.changes[0]!.ciphertext).toBe('A');
  });
});
