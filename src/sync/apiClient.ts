// Authorized sync API client. Attaches the Cognito JWT and calls /sync/*.
// Stage 3 establishes the authorized surface; the full sync engine (offline
// queue, LWW, change tracking) arrives in Stage 5.

import { getBackendConfig } from '../config';
import { getIdToken } from '../auth/cognito';

export interface Envelope {
  id: string;
  updatedAt: number;
  version: number;
  deleted?: boolean;
  payload: string; // opaque pass-through at Stage 3; readable, typed record from Stage 4
}

export interface PullResponse {
  changes: Envelope[];
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

export async function push(changes: Envelope[]): Promise<PushResponse> {
  const { baseUrl, token } = await context();
  return syncRequest<PushResponse>(baseUrl, token, '/sync/push', { changes });
}
