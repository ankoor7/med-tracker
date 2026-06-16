// LocalRepository — Dexie/IndexedDB implementation of the Repository seam.
// Stage 2. Dexie types are confined to this module (architecture: don't leak
// Dexie upward). Stages 4/5 wrap this for encryption and sync.

import Dexie, { type Table } from 'dexie';
import type { Dataset, DoseLogEntry, Medication, Settings, Slot } from '../core/types';
import type { Repository, TableName } from './repository';
import { CURRENT_SCHEMA_VERSION, runMigrations } from './migrations';

const SETTINGS_ID = 'app';
const META_SCHEMA_VERSION = 'schemaVersion';

type StoredSettings = Settings & { id: string };
interface MetaRow {
  key: string;
  value: string;
}

export class SteadyDoseDB extends Dexie {
  medications!: Table<Medication, string>;
  slots!: Table<Slot, string>;
  doseLog!: Table<DoseLogEntry, string>;
  settings!: Table<StoredSettings, string>;
  meta!: Table<MetaRow, string>;

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
  }
}

const TABLES: TableName[] = ['medications', 'slots', 'doseLog'];

export class LocalRepository implements Repository {
  constructor(private readonly db: SteadyDoseDB = new SteadyDoseDB()) {}

  async loadAll(): Promise<Dataset | null> {
    const [medications, slots, doseLog, settingsRow, versionStr] = await Promise.all([
      this.db.medications.toArray(),
      this.db.slots.toArray(),
      this.db.doseLog.toArray(),
      this.db.settings.get(SETTINGS_ID),
      this.getMeta(META_SCHEMA_VERSION),
    ]);

    // First run: nothing persisted yet.
    if (!settingsRow && medications.length === 0 && slots.length === 0 && doseLog.length === 0) {
      return null;
    }

    const settings = settingsRow ? stripId(settingsRow) : fallbackSettings();
    const loaded: Dataset = { medications, slots, doseLog, settings };

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
    await this.db.table(table).put(record);
  }

  async remove(table: TableName, id: string): Promise<void> {
    // Soft delete: tombstone the record (FR-2.2). Never a hard delete pre-sync.
    const existing = await this.db
      .table<{ id: string; updatedAt: number; deleted?: boolean }>(table)
      .get(id);
    if (!existing) return;
    await this.db.table(table).put({ ...existing, deleted: true, updatedAt: Date.now() });
  }

  async putSettings(settings: Settings): Promise<void> {
    await this.db.settings.put({ ...settings, id: SETTINGS_ID });
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
      [this.db.medications, this.db.slots, this.db.doseLog, this.db.settings],
      async () => {
        await this.db.medications.bulkPut(data.medications);
        await this.db.slots.bulkPut(data.slots);
        await this.db.doseLog.bulkPut(data.doseLog);
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
