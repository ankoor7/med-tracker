// LocalRepository — Dexie/IndexedDB implementation of the Repository seam.
// Stage 2. Dexie types are confined to this module (architecture: don't leak
// Dexie upward). Stages 4/5 wrap this for encryption and sync.

import Dexie, { type Table } from 'dexie';
import { isNewerRecord, type SyncRecord } from '../core/cloudRecord';
import type {
  Dataset,
  DoseLogEntry,
  DoseOverride,
  Medication,
  Settings,
  Slot,
} from '../core/types';
import type { OutboxRef, Repository, TableName } from './repository';
import { fromSyncRecord, toSyncRecord } from '../sync/recordMapping';
import { CURRENT_SCHEMA_VERSION, runMigrations } from './migrations';

const SETTINGS_ID = 'app';
const META_SCHEMA_VERSION = 'schemaVersion';
const META_SYNC_TOKEN = 'lastSyncToken';

type StoredSettings = Settings & { id: string };
interface MetaRow {
  key: string;
  value: string;
}

export class SteadyDoseDB extends Dexie {
  medications!: Table<Medication, string>;
  slots!: Table<Slot, string>;
  doseLog!: Table<DoseLogEntry, string>;
  doseOverrides!: Table<DoseOverride, string>;
  settings!: Table<StoredSettings, string>;
  meta!: Table<MetaRow, string>;
  outbox!: Table<SyncRecord, string>;

  constructor(name = 'steadydose') {
    super(name);
    // v1 structural schema. Indexes chosen for sync (updatedAt) and lookups.
    this.version(1).stores({
      medications: 'id, updatedAt, deleted',
      slots: 'id, updatedAt, deleted',
      doseLog: 'id, updatedAt, deleted, medId, slotId',
      settings: 'id',
      meta: 'key',
    });
    // v2 (Stage 5): durable sync outbox — one row per record id (its latest
    // pending version), so the queue is bounded and replays idempotently.
    this.version(2).stores({
      outbox: 'id',
    });
    // v3 (Stage 12): one-time next-dose overrides; same index shape as doseLog.
    this.version(3).stores({
      doseOverrides: 'id, updatedAt, deleted, medId, slotId',
    });
  }
}

const TABLES: TableName[] = ['medications', 'slots', 'doseLog', 'doseOverrides'];

export class LocalRepository implements Repository {
  constructor(private readonly db: SteadyDoseDB = new SteadyDoseDB()) {}

  async loadAll(): Promise<Dataset | null> {
    const [medications, slots, doseLog, doseOverrides, settingsRow, versionStr] = await Promise.all(
      [
        this.db.medications.toArray(),
        this.db.slots.toArray(),
        this.db.doseLog.toArray(),
        this.db.doseOverrides.toArray(),
        this.db.settings.get(SETTINGS_ID),
        this.getMeta(META_SCHEMA_VERSION),
      ],
    );

    // First run: nothing persisted yet.
    if (!settingsRow && medications.length === 0 && slots.length === 0 && doseLog.length === 0) {
      return null;
    }

    const settings = settingsRow ? stripId(settingsRow) : fallbackSettings();
    const loaded: Dataset = { medications, slots, doseLog, doseOverrides, settings };

    // Run forward data migrations if the stored version is behind.
    const fromVersion = versionStr ? Number(versionStr) : CURRENT_SCHEMA_VERSION;
    const { data, version } = runMigrations(loaded, fromVersion);
    if (version !== fromVersion) {
      await this.persistDataset(data);
    }
    await this.setMeta(META_SCHEMA_VERSION, String(Math.max(version, CURRENT_SCHEMA_VERSION)));
    return data;
  }

  async upsert<T extends { id: string }>(table: TableName, record: T): Promise<void> {
    await this.db.transaction('rw', this.db.table(table), this.db.outbox, async () => {
      await this.db.table(table).put(record);
      await this.enqueue(table, record);
    });
  }

  async remove(table: TableName, id: string): Promise<void> {
    // Soft delete: tombstone the record (FR-2.2). Never a hard delete pre-sync.
    const existing = await this.db
      .table<{ id: string; updatedAt: number; version?: number; deleted?: boolean }>(table)
      .get(id);
    if (!existing) return;
    const tombstoned = {
      ...existing,
      deleted: true,
      updatedAt: Date.now(),
      version: (existing.version ?? 0) + 1,
    };
    await this.db.transaction('rw', this.db.table(table), this.db.outbox, async () => {
      await this.db.table(table).put(tombstoned);
      await this.enqueue(table, tombstoned);
    });
  }

  async putSettings(settings: Settings): Promise<void> {
    const row = { ...settings, id: SETTINGS_ID };
    await this.db.transaction('rw', this.db.settings, this.db.outbox, async () => {
      await this.db.settings.put(row);
      await this.enqueue('settings', row);
    });
  }

  /** Stage local change of `record` for the next push (one row per record id). */
  private async enqueue(table: TableName, record: { id: string }): Promise<void> {
    const rec = toSyncRecord(table, record as never);
    await this.db.outbox.put(rec);
  }

  async readOutbox(): Promise<SyncRecord[]> {
    return this.db.outbox.toArray();
  }

  async clearOutbox(refs: OutboxRef[]): Promise<void> {
    if (refs.length === 0) return;
    await this.db.transaction('rw', this.db.outbox, async () => {
      for (const ref of refs) {
        const current = await this.db.outbox.get(ref.id);
        // Skip if a newer local edit re-enqueued the same id while we were pushing.
        if (current && current.version === ref.version) {
          await this.db.outbox.delete(ref.id);
        }
      }
    });
  }

  async applyRemote(rec: SyncRecord): Promise<boolean> {
    const { table, entity } = fromSyncRecord(rec);
    // Write straight to the table (NOT via upsert) so a pulled record is not
    // re-queued back into the outbox.
    const dest = this.db.table<{ updatedAt: number; version?: number }, string>(table);
    const existing = await dest.get(entity.id);
    const existingOrder = existing
      ? { updatedAt: existing.updatedAt, version: existing.version ?? 1 }
      : undefined;
    if (!isNewerRecord(rec, existingOrder)) return false;
    await dest.put(entity as never);
    return true;
  }

  async getSyncToken(): Promise<number> {
    const raw = await this.getMeta(META_SYNC_TOKEN);
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  async setSyncToken(token: number): Promise<void> {
    await this.setMeta(META_SYNC_TOKEN, String(token));
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.meta.get(key);
    return row ? row.value : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  /** Write a whole dataset (used after a migration). */
  private async persistDataset(data: Dataset): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.medications,
        this.db.slots,
        this.db.doseLog,
        this.db.doseOverrides,
        this.db.settings,
      ],
      async () => {
        await this.db.medications.bulkPut(data.medications);
        await this.db.slots.bulkPut(data.slots);
        await this.db.doseLog.bulkPut(data.doseLog);
        await this.db.doseOverrides.bulkPut(data.doseOverrides);
        await this.putSettings(data.settings);
      },
    );
  }
}

function stripId(row: StoredSettings): Settings {
  const { id: _id, ...rest } = row;
  void _id;
  return rest;
}

function fallbackSettings(): Settings {
  return {
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London',
    adherenceWindowDays: 7,
    missedDayThreshold: 3,
    updatedAt: Date.now(),
    version: 1,
  };
}

export { TABLES };
