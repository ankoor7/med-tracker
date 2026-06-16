// Sync handler core — transport-agnostic business logic for /sync/pull and
// /sync/push. Reused by the Lambda adapter and the local Express server.
// Stage 3: opaque pass-through envelopes, per-user isolation, version guard.
// Stage 4 adds readable, typed payloads + server-side schema validation (not
// zero-knowledge). Full conflict resolution / offline queue is Stage 5.

import type {
  Envelope,
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  PushResult,
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
  for (const env of body.changes) {
    const validation = validateEnvelope(env);
    if (validation) {
      results.push({ id: env?.id ?? '(missing id)', accepted: false, reason: validation });
      continue;
    }
    const accepted = await store.putIfNewer(userId, env);
    results.push(
      accepted
        ? { id: env.id, accepted: true }
        : { id: env.id, accepted: false, reason: 'stale version' },
    );
  }
  return { results };
}

function normaliseSince(since: unknown): number {
  if (since == null) return 0;
  const n = Number(since);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function validateEnvelope(env: Envelope | undefined): string | null {
  if (!env || typeof env !== 'object') return 'invalid envelope';
  if (typeof env.id !== 'string' || env.id.length === 0) return 'missing id';
  if (typeof env.updatedAt !== 'number' || !Number.isFinite(env.updatedAt))
    return 'missing updatedAt';
  if (typeof env.version !== 'number' || !Number.isFinite(env.version)) return 'missing version';
  if (typeof env.payload !== 'string') return 'missing payload';
  return null;
}
