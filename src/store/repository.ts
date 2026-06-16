// Repository interface — the persistence seam. See specs/stage-2 §5.
//
// Stage 1 ships a no-op (in-memory) implementation. Stage 2 provides a
// Dexie/IndexedDB `LocalRepository`; Stages 4/5 wrap it for encryption/sync.
// Keep this interface STABLE — higher layers depend on it and must not see
// Dexie types.

import type { Dataset } from '../core/types';

export type TableName = 'medications' | 'slots' | 'doseLog' | 'settings';

export interface Repository {
  /** Load the full dataset, or null on first run (no data yet). */
  loadAll(): Promise<Dataset | null>;
  /** Insert or replace a record (already stamped with updatedAt/version). */
  upsert<T extends { id: string }>(table: TableName, record: T): Promise<void>;
  /** Soft-delete a record (tombstone). */
  remove(table: TableName, id: string): Promise<void>;
  /** Replace the singleton settings record. */
  putSettings(settings: Dataset['settings']): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}

/** No-op repository: Stage 1 in-memory mode. Nothing persists. */
export const nullRepository: Repository = {
  async loadAll() {
    return null;
  },
  async upsert() {},
  async remove() {},
  async putSettings() {},
  async getMeta() {
    return null;
  },
  async setMeta() {},
};

// The active repository. Stage 2 swaps this for the LocalRepository at boot.
let active: Repository = nullRepository;

export function getRepository(): Repository {
  return active;
}

export function setRepository(repo: Repository): void {
  active = repo;
}
