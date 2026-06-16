// In-memory SyncStore — used by tests and available as a zero-dependency mode
// for the local server when DynamoDB isn't running.

import { isNewerRecord } from '../../src/core/cloudRecord';
import type { SyncRecord, SyncStore } from './types';

export class InMemorySyncStore implements SyncStore {
  private readonly byUser = new Map<string, Map<string, SyncRecord>>();

  async querySince(userId: string, since: number): Promise<SyncRecord[]> {
    const records = this.byUser.get(userId);
    if (!records) return [];
    return [...records.values()]
      .filter((e) => e.updatedAt > since)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .map((e) => ({ ...e }));
  }

  async putIfNewer(userId: string, rec: SyncRecord): Promise<boolean> {
    let records = this.byUser.get(userId);
    if (!records) {
      records = new Map();
      this.byUser.set(userId, records);
    }
    const existing = records.get(rec.id);
    // Last-write-wins on (updatedAt, version) — same guard as the client merge
    // and the DynamoDB conditional write, so all three ends converge identically.
    if (!isNewerRecord(rec, existing)) return false;
    records.set(rec.id, { ...rec });
    return true;
  }
}
