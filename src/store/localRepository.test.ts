import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository, SteadyDoseDB } from './localRepository';
import { med, settings, slot, logEntry } from '../test/fixtures';

let dbName: string;
let db: SteadyDoseDB;
let repo: LocalRepository;
let counter = 0;

beforeEach(() => {
  dbName = `steadydose-test-${++counter}-${Date.now()}`;
  db = new SteadyDoseDB(dbName);
  repo = new LocalRepository(db);
});

afterEach(async () => {
  db.close();
  await SteadyDoseDB.delete(dbName);
});

describe('LocalRepository', () => {
  it('returns null on first run (empty DB)', async () => {
    expect(await repo.loadAll()).toBeNull();
  });

  it('round-trips medications, slots and dose-log entries', async () => {
    const m = med({ id: 'a', name: 'Lamotrigine' });
    const s = slot({ id: 's1', items: [{ medId: 'a', dose: 100 }] });
    const e = logEntry({ id: 'l1', medId: 'a', slotId: 's1' });
    await repo.upsert('medications', m);
    await repo.upsert('slots', s);
    await repo.upsert('doseLog', e);
    await repo.putSettings(settings({ zone: 'Europe/London' }));

    const loaded = await repo.loadAll();
    expect(loaded).not.toBeNull();
    expect(loaded!.medications).toEqual([m]);
    expect(loaded!.slots).toEqual([s]);
    expect(loaded!.doseLog).toEqual([e]);
    expect(loaded!.settings.zone).toBe('Europe/London');
  });

  it('upsert replaces an existing record by id', async () => {
    await repo.upsert('medications', med({ id: 'a', name: 'Old' }));
    await repo.upsert('medications', med({ id: 'a', name: 'New' }));
    const loaded = await repo.loadAll();
    expect(loaded!.medications).toHaveLength(1);
    expect(loaded!.medications[0]!.name).toBe('New');
  });

  it('remove tombstones a record (soft delete, still present as deleted)', async () => {
    await repo.upsert('medications', med({ id: 'a' }));
    await repo.remove('medications', 'a');
    const loaded = await repo.loadAll();
    expect(loaded!.medications).toHaveLength(1);
    expect(loaded!.medications[0]!.deleted).toBe(true);
  });

  it('meta get/set round-trips', async () => {
    expect(await repo.getMeta('lastSyncToken')).toBeNull();
    await repo.setMeta('lastSyncToken', 'abc123');
    expect(await repo.getMeta('lastSyncToken')).toBe('abc123');
  });

  it('stamps the schema version in meta after load', async () => {
    await repo.upsert('medications', med({ id: 'a' }));
    await repo.loadAll();
    expect(await repo.getMeta('schemaVersion')).toBe('1');
  });

  it('persists data across a fresh repository on the same DB (reload, AC1)', async () => {
    await repo.upsert('medications', med({ id: 'a', name: 'Persisted' }));
    await repo.putSettings(settings());
    db.close();

    const db2 = new SteadyDoseDB(dbName);
    const repo2 = new LocalRepository(db2);
    const loaded = await repo2.loadAll();
    expect(loaded!.medications[0]!.name).toBe('Persisted');
    db2.close();
  });
});
