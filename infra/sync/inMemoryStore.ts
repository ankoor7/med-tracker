// In-memory SyncStore — used by tests and available as a zero-dependency mode
// for the local server when DynamoDB isn't running.

import type { Envelope, SyncStore } from './types';

export class InMemorySyncStore implements SyncStore {
  private readonly byUser = new Map<string, Map<string, Envelope>>();

  async querySince(userId: string, since: number): Promise<Envelope[]> {
    const records = this.byUser.get(userId);
    if (!records) return [];
    return [...records.values()]
      .filter((e) => e.updatedAt > since)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .map((e) => ({ ...e }));
  }

  async putIfNewer(userId: string, env: Envelope): Promise<boolean> {
    let records = this.byUser.get(userId);
    if (!records) {
      records = new Map();
      this.byUser.set(userId, records);
    }
    const existing = records.get(env.id);
    if (existing && existing.version >= env.version) return false;
    records.set(env.id, { ...env });
    return true;
  }
}
