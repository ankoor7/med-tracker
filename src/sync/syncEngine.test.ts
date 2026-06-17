import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository, SteadyDoseDB } from '../store/localRepository';
import { runSync, type SyncBackend, type SyncLocal } from './syncEngine';
import { isNewerRecord, validateSyncRecord, type SyncRecord } from '../core/cloudRecord';
import { med } from '../test/fixtures';

// A storage-agnostic in-memory SyncBackend that mirrors the server logic now in
// SQL (supabase/migrations): single-user isolation, the shared schema validation
// (validateSyncRecord = validate_record), and the LWW version guard
// (isNewerRecord = the push_records conflict predicate). So these tests exercise
// the real conflict + validation rules, not a stub.
function makeBackend(): SyncBackend {
  const store = new Map<string, SyncRecord>();
  return {
    pull: async (since) => {
      const changes = [...store.values()]
        .filter((r) => r.updatedAt > since)
        .sort((a, b) => a.updatedAt - b.updatedAt);
      const token = changes.reduce((max, r) => Math.max(max, r.updatedAt), since);
      return { changes, token };
    },
    push: async (changes) => ({
      results: changes.map((rec) => {
        const validation = validateSyncRecord(rec);
        if (!validation.ok) return { id: rec.id, accepted: false, reason: validation.reason };
        if (!isNewerRecord(rec, store.get(rec.id))) {
          return { id: rec.id, accepted: false, reason: 'stale version' };
        }
        store.set(rec.id, rec);
        return { id: rec.id, accepted: true };
      }),
    }),
  };
}

// Each device is an independent local store sharing one backend (same user).
const dbs: SteadyDoseDB[] = [];
function makeDevice(tag: string): LocalRepository {
  const db = new SteadyDoseDB(`steadydose-${tag}-${dbs.length}-${Date.now()}`);
  dbs.push(db);
  return new LocalRepository(db);
}

/** Sync a set of devices repeatedly until the shared backend stops changing. */
async function converge(
  devices: LocalRepository[],
  backend: SyncBackend,
  rounds = 3,
): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    for (const d of devices) await runSync(d, backend);
  }
}

async function medById(repo: LocalRepository, id: string) {
  const loaded = await repo.loadAll();
  return loaded?.medications.find((m) => m.id === id);
}

beforeEach(() => {
  dbs.length = 0;
});

afterEach(async () => {
  for (const db of dbs) {
    const name = db.name;
    db.close();
    await SteadyDoseDB.delete(name);
  }
});

describe('two-device sync', () => {
  it('propagates an offline edit from A to B (AC1)', async () => {
    const backend = makeBackend();
    const a = makeDevice('a');
    const b = makeDevice('b');

    await a.upsert(
      'medications',
      med({ id: 'x', name: 'Lamotrigine', updatedAt: 1000, version: 1 }),
    );
    await converge([a, b], backend);

    expect((await medById(b, 'x'))?.name).toBe('Lamotrigine');
  });

  it('resolves a concurrent edit by last-write-wins on updatedAt (AC2)', async () => {
    const backend = makeBackend();
    const a = makeDevice('a');
    const b = makeDevice('b');

    await a.upsert('medications', med({ id: 'x', name: 'seed', updatedAt: 1000, version: 1 }));
    await converge([a, b], backend);

    // Both edit the same record offline; B's edit is later.
    await a.upsert('medications', med({ id: 'x', name: 'fromA', updatedAt: 2000, version: 2 }));
    await b.upsert('medications', med({ id: 'x', name: 'fromB', updatedAt: 3000, version: 2 }));
    await converge([a, b], backend);

    expect((await medById(a, 'x'))?.name).toBe('fromB');
    expect((await medById(b, 'x'))?.name).toBe('fromB');
  });

  it('propagates a deletion via tombstone (AC3)', async () => {
    const backend = makeBackend();
    const a = makeDevice('a');
    const b = makeDevice('b');

    await a.upsert('medications', med({ id: 'x', name: 'doomed', updatedAt: 1000, version: 1 }));
    await converge([a, b], backend);
    expect((await medById(b, 'x'))?.deleted).toBeFalsy();

    await a.remove('medications', 'x');
    await converge([a, b], backend);

    expect((await medById(b, 'x'))?.deleted).toBe(true);
  });

  it('resumes after an interrupted push without duplicating or losing data (AC4)', async () => {
    const backend = makeBackend();
    const a = makeDevice('a');
    const b = makeDevice('b');

    await a.upsert('medications', med({ id: 'x', name: 'resumed', updatedAt: 1000, version: 1 }));

    // Simulate a crash AFTER the server accepted the push but BEFORE the client
    // cleared its outbox: push directly, leaving the outbox dirty.
    await backend.push(await a.readOutbox());

    // The retry re-pushes the same record (server reports it stale) and still
    // converges to a single copy on B.
    await converge([a, b], backend);

    const all = (await b.loadAll())?.medications.filter((m) => m.id === 'x') ?? [];
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('resumed');
    expect(await a.readOutbox()).toHaveLength(0);
  });

  it('is idempotent when the same sync runs again (AC5)', async () => {
    const backend = makeBackend();
    const a = makeDevice('a');
    const b = makeDevice('b');

    await a.upsert('medications', med({ id: 'x', name: 'once', updatedAt: 1000, version: 1 }));
    await converge([a, b], backend);
    const before = (await b.loadAll())?.medications;

    // Re-running sync with no new local changes must not duplicate or alter data.
    const result = await runSync(b, backend);
    expect(result.applied).toBe(0);
    expect((await b.loadAll())?.medications).toEqual(before);
  });
});

describe('server-side validation surfaced through the engine (AC7)', () => {
  it('rejects an invalid record while accepting its valid siblings', async () => {
    const backend = makeBackend();
    const valid: SyncRecord = {
      id: 'good',
      type: 'medication',
      updatedAt: 1000,
      version: 1,
      payload: {
        id: 'good',
        name: 'Valid',
        color: '#0f766e',
        unit: 'mg',
        halfLifeHours: 12,
        adjustWhenLate: true,
        active: true,
        guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
      },
    };
    // Missing required payload fields → fails the shared schema on the server.
    const invalid: SyncRecord = {
      id: 'bad',
      type: 'medication',
      updatedAt: 1000,
      version: 1,
      payload: { id: 'bad' },
    };

    const local: SyncLocal = {
      readOutbox: async () => [valid, invalid],
      clearOutbox: async () => {},
      applyRemote: async () => false,
      getSyncToken: async () => 0,
      setSyncToken: async () => {},
    };

    const result = await runSync(local, backend);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.id).toBe('bad');
    expect(result.rejected[0]?.reason).toBeTruthy();

    // The valid sibling is stored and readable on the server (Stage 4).
    const pulled = await backend.pull(0);
    const stored = pulled.changes.find((r) => r.id === 'good');
    expect((stored?.payload as { name: string }).name).toBe('Valid');
  });
});
