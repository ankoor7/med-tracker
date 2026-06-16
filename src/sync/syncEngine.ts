// Sync engine — the bidirectional pull/push orchestration (Stage 5).
//
// One sync round: push the durable outbox, then pull remote changes and merge
// them by last-write-wins. The engine is transport- and storage-agnostic: it
// takes a `Repository` (local side) and a `SyncBackend` (the network), so it is
// driven by `useSync` in the app and by an in-memory two-device harness in tests.
//
// Properties:
//  - Resumable & idempotent (FR-5.2/5.4): the outbox persists; re-pushing or
//    re-pulling the same (id, version) changes nothing (`isNewerRecord` no-ops).
//  - LWW conflict resolution (FR-5.3): both the server guard and `applyRemote`
//    resolve on (updatedAt, version).
//  - Per-id validation surfaced (FR-5.7): schema/ownership rejections are
//    returned without blocking the valid records in the same batch.

import {
  pull as apiPull,
  push as apiPush,
  type PullResponse,
  type PushResponse,
  type PushResult,
} from './apiClient';
import type { SyncRecord } from '../core/cloudRecord';
import type { OutboxRef, Repository } from '../store/repository';

export type { PushResult };

/** Network port. Defaults to the authorized API client; injectable for tests. */
export interface SyncBackend {
  pull(since: number): Promise<PullResponse>;
  push(changes: SyncRecord[]): Promise<PushResponse>;
}

export const defaultBackend: SyncBackend = {
  pull: (since) => apiPull(since),
  push: (changes) => apiPush(changes),
};

/** The local side the engine needs — a structural subset of `Repository`. */
export type SyncLocal = Pick<
  Repository,
  'readOutbox' | 'clearOutbox' | 'applyRemote' | 'getSyncToken' | 'setSyncToken'
>;

export interface SyncResult {
  pushed: number; // records sent to the server
  accepted: number; // accepted by the server
  rejected: PushResult[]; // schema/ownership rejections to surface to the user
  pulled: number; // records returned by the pull
  applied: number; // records that changed local state (LWW winners)
  token: number; // new sync cursor
}

function isStaleRejection(reason?: string): boolean {
  // The server reports a LWW loss as "stale …"; the record will arrive via pull,
  // so we drop it from the outbox silently rather than surfacing it as an error.
  return !!reason && /stale/i.test(reason);
}

export async function runSync(
  local: SyncLocal,
  backend: SyncBackend = defaultBackend,
): Promise<SyncResult> {
  // 1. PUSH — drain the durable outbox.
  const outbox = await local.readOutbox();
  const rejected: PushResult[] = [];
  let accepted = 0;

  if (outbox.length > 0) {
    const { results } = await backend.push(outbox);
    const sentById = new Map(outbox.map((r) => [r.id, r]));
    const handled: OutboxRef[] = [];
    for (const result of results) {
      const sent = sentById.get(result.id);
      if (!sent) continue;
      // Clear every record the server answered for — accepted (done), stale
      // (pull will reconcile), or invalid (retrying won't help, so don't loop).
      handled.push({ id: result.id, version: sent.version });
      if (result.accepted) accepted++;
      else if (!isStaleRejection(result.reason)) rejected.push(result);
    }
    await local.clearOutbox(handled);
  }

  // 2. PULL — fetch since the last cursor and merge by LWW.
  const since = await local.getSyncToken();
  const { changes, token } = await backend.pull(since);
  let applied = 0;
  for (const rec of changes) {
    if (await local.applyRemote(rec)) applied++;
  }
  const nextToken = Math.max(token, since);
  await local.setSyncToken(nextToken);

  return {
    pushed: outbox.length,
    accepted,
    rejected,
    pulled: changes.length,
    applied,
    token: nextToken,
  };
}
