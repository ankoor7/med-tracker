// Repository interface — the persistence seam. See specs/stage-2 §5.
//
// Stage 1 ships a no-op (in-memory) implementation. Stage 2 provides a
// Dexie/IndexedDB `LocalRepository`; Stage 5 wraps it for sync (and Stage 4 may
// add an optional on-device cache lock).
// Keep this interface STABLE — higher layers depend on it and must not see
// Dexie types.

import type { SyncRecord } from '../core/cloudRecord';
import type { Dataset } from '../core/types';

export type TableName = 'medications' | 'slots' | 'doseLog' | 'settings';

/** Identifies a specific version of a record in the outbox. */
export interface OutboxRef {
  id: string;
  version: number;
}

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

  // ---- Stage 5 sync support -------------------------------------------------
  /** Pending local changes to push, one row per record id (latest version). */
  readOutbox(): Promise<SyncRecord[]>;
  /** Drop outbox rows whose (id, version) match `refs` (skip if superseded). */
  clearOutbox(refs: OutboxRef[]): Promise<void>;
  /**
   * Merge a remote record into the local store using last-write-wins. Writes
   * directly (does NOT re-enqueue to the outbox). Returns true if it changed
   * local state, false if the local copy was already newer/equal.
   */
  applyRemote(rec: SyncRecord): Promise<boolean>;
  /** Sync cursor: the server high-water mark from the last successful pull. */
  getSyncToken(): Promise<number>;
  setSyncToken(token: number): Promise<void>;
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
  async readOutbox() {
    return [];
  },
  async clearOutbox() {},
  async applyRemote() {
    return false;
  },
  async getSyncToken() {
    return 0;
  },
  async setSyncToken() {},
};

// The active repository. Stage 2 swaps this for the LocalRepository at boot.
let active: Repository = nullRepository;

export function getRepository(): Repository {
  return active;
}

export function setRepository(repo: Repository): void {
  active = repo;
}
