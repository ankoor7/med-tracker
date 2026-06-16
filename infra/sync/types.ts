// Sync API contract — shared by the Lambda and the local dev server.
// See specs/02-architecture.md §8 and stage-3 §5.
//
// Records are opaque ciphertext envelopes. The server never sees plaintext and,
// at Stage 3, performs no decryption — it stores and returns bytes. The
// authenticated `userId` (from the JWT) is the partition; clients cannot read or
// write another user's data.

export interface Envelope {
  id: string;
  updatedAt: number; // epoch ms; also the incremental-pull cursor
  version: number;
  deleted?: boolean;
  ciphertext: string; // base64 / opaque payload
}

export interface PullRequest {
  since?: number; // token from a previous pull (0/undefined = full)
}

export interface PullResponse {
  changes: Envelope[];
  token: number; // high-water mark to pass as `since` next time
}

export interface PushRequest {
  changes: Envelope[];
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
  /** Envelopes for `userId` with `updatedAt > since`, ascending by updatedAt. */
  querySince(userId: string, since: number): Promise<Envelope[]>;
  /**
   * Conditionally write an envelope: accept only if it is new or strictly newer
   * (incoming.version > stored.version). Returns whether it was accepted.
   */
  putIfNewer(userId: string, env: Envelope): Promise<boolean>;
}
