// Authorized sync API client. Attaches the Cognito JWT and calls /sync/*.
// Stage 3 established the authorized surface; Stage 4 moves readable, typed
// records (validated client-side against the shared schema before push). The full
// sync engine (offline queue, LWW, change tracking) arrives in Stage 5.

import { getBackendConfig } from '../config';
import { getIdToken } from '../auth/cognito';
import { validateSyncRecord, type SyncRecord } from '../core/cloudRecord';

export type { SyncRecord };

export interface PullResponse {
  changes: SyncRecord[];
  token: number;
}

export interface PushResult {
  id: string;
  accepted: boolean;
  reason?: string;
}

export interface PushResponse {
  results: PushResult[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type FetchLike = typeof fetch;

/** Low-level, injectable request used by pull/push (and unit tests). */
export async function syncRequest<T>(
  baseUrl: string,
  token: string,
  path: string,
  body: unknown,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const res = await fetchImpl(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('unauthorized', res.status);
  }
  if (!res.ok) {
    throw new ApiError(`sync request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

async function context(): Promise<{ baseUrl: string; token: string }> {
  const cfg = getBackendConfig();
  if (!cfg) throw new ApiError('backend not configured', 0);
  const token = await getIdToken();
  if (!token) throw new ApiError('not signed in', 401);
  return { baseUrl: cfg.apiBaseUrl, token };
}

export async function pull(since = 0): Promise<PullResponse> {
  const { baseUrl, token } = await context();
  return syncRequest<PullResponse>(baseUrl, token, '/sync/pull', { since });
}

export async function push(changes: SyncRecord[]): Promise<PushResponse> {
  // Validate against the shared schema before we spend a round-trip; the server
  // re-validates with the same module, so this is a fast-fail convenience.
  for (const rec of changes) {
    const result = validateSyncRecord(rec);
    if (!result.ok) throw new ApiError(`invalid record ${rec.id}: ${result.reason}`, 0);
  }
  const { baseUrl, token } = await context();
  return syncRequest<PushResponse>(baseUrl, token, '/sync/push', { changes });
}
