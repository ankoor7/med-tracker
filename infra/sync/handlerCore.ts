// Sync handler core — transport-agnostic business logic for /sync/pull and
// /sync/push. Reused by the Lambda adapter and the local Express server.
//
// Stage 4: readable, typed records with server-side schema validation (the cloud
// is NOT zero-knowledge). Per-user isolation (userId is supplied by the verified
// JWT, never the body) and a version guard are enforced here. Full conflict
// resolution / offline queue is Stage 5.

import { validateSyncRecord } from '../../src/core/cloudRecord';
import type {
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  PushResult,
  SyncRecord,
  SyncStore,
} from './types';

export class BadRequestError extends Error {}

export async function handlePull(
  store: SyncStore,
  userId: string,
  body: PullRequest,
): Promise<PullResponse> {
  const since = normaliseSince(body?.since);
  const changes = await store.querySince(userId, since);
  // New high-water mark: the largest updatedAt we are returning.
  const token = changes.reduce((max, e) => Math.max(max, e.updatedAt), since);
  return { changes, token };
}

export async function handlePush(
  store: SyncStore,
  userId: string,
  body: PushRequest,
): Promise<PushResponse> {
  if (!body || !Array.isArray(body.changes)) {
    throw new BadRequestError('changes[] required');
  }
  const results: PushResult[] = [];
  for (const rec of body.changes) {
    // Server-side schema + type + size validation (AC3) — same module the client
    // runs before push, so the contract is enforced identically on both ends.
    const validation = validateSyncRecord(rec);
    if (!validation.ok) {
      results.push({ id: idOf(rec), accepted: false, reason: validation.reason });
      continue;
    }
    // userId comes from the verified JWT (AC2) — the record never names its owner.
    const accepted = await store.putIfNewer(userId, rec as SyncRecord);
    results.push(
      accepted
        ? { id: rec.id, accepted: true }
        : { id: rec.id, accepted: false, reason: 'stale version' },
    );
  }
  return { results };
}

function normaliseSince(since: unknown): number {
  if (since == null) return 0;
  const n = Number(since);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function idOf(rec: unknown): string {
  if (rec && typeof rec === 'object' && typeof (rec as { id?: unknown }).id === 'string') {
    return (rec as { id: string }).id;
  }
  return '(missing id)';
}
