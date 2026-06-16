// Sync API contract — shared by the Lambda and the local dev server.
// See specs/02-architecture.md §8 and stage-4 §5.
//
// The cloud is NOT zero-knowledge. From Stage 4 a record carries a readable,
// typed `payload` object discriminated by `type`, which the server parses,
// validates, and can operate on. The canonical record shape and its schema
// validation live in the domain core (`src/core/cloudRecord.ts`) so the client
// and the server share one source of truth. The authenticated `userId` (from the
// JWT) is the partition; clients cannot read or write another user's data.

import type { SyncRecord } from '../../src/core/cloudRecord';

export type { SyncRecord };

export interface PullRequest {
  since?: number; // token from a previous pull (0/undefined = full)
}

export interface PullResponse {
  changes: SyncRecord[];
  token: number; // high-water mark to pass as `since` next time
}

export interface PushRequest {
  changes: SyncRecord[];
}

export type PushResult = { id: string; accepted: boolean; reason?: string };

export interface PushResponse {
  results: PushResult[];
}

/**
 * Storage port. The handler-core depends on this, not on DynamoDB directly, so
 * it is trivially testable with an in-memory implementation and reusable across
 * the Lambda (DynamoDB) and local server (DynamoDB on LocalStack).
 */
export interface SyncStore {
  /** Records for `userId` with `updatedAt > since`, ascending by updatedAt. */
  querySince(userId: string, since: number): Promise<SyncRecord[]>;
  /**
   * Conditionally write a record: accept only if it is new or strictly newer
   * (incoming.version > stored.version). Returns whether it was accepted.
   */
  putIfNewer(userId: string, rec: SyncRecord): Promise<boolean>;
}
