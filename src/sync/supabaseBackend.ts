// Supabase sync backend — the `SyncBackend` port implemented over Postgres.
// Replaces the AWS `apiClient.ts` (API Gateway + Lambda). The functional contract
// is identical, so the sync engine, store, and `useSync` are unchanged above this
// seam:
//   - pull(since): a direct PostgREST select, scoped to the caller by RLS. The
//     high-water token is computed exactly as `handlePull` did (max updatedAt,
//     floored at `since`).
//   - push(changes): the `push_records` RPC, which runs the LWW version guard +
//     per-record validation in SQL and returns a per-id verdict.
// The supabase-js client attaches the current GoTrue access token automatically,
// so every request carries the JWT that `auth.uid()` reads.

import { getSupabase } from '../supabase/client';
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

/**
 * A sync transport failure. `offline` distinguishes an expected network outage
 * (retry later, show "offline") from a real error (surface it), preserving
 * `useSync`'s offline-vs-error branch that `ApiError(status)` used to drive.
 */
export class SyncError extends Error {
  constructor(
    message: string,
    readonly offline: boolean,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/** The raw `records` row shape returned by PostgREST (snake_case). */
interface RawRow {
  id: string;
  type: SyncRecord['type'];
  updated_at: number | string;
  version: number | string;
  deleted: boolean;
  payload: object;
}

function rowToRecord(row: RawRow): SyncRecord {
  return {
    id: row.id,
    type: row.type,
    updatedAt: Number(row.updated_at),
    version: Number(row.version),
    payload: row.payload,
    ...(row.deleted ? { deleted: true } : {}),
  };
}

/** A PostgREST/Postgres error carries a code; a network failure does not. */
function isOfflineError(error: { code?: string | null } | null, message: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (error?.code) return false;
  const m = message.toLowerCase();
  return m.includes('fetch') || m.includes('network') || m.includes('load failed');
}

function toSyncError(error: { message?: string; code?: string | null } | null): SyncError {
  const message = error?.message ?? 'sync failed';
  return new SyncError(message, isOfflineError(error, message));
}

export async function pull(since = 0): Promise<PullResponse> {
  const { data, error } = await getSupabase()
    .from('records')
    .select('id,type,updated_at,version,deleted,payload')
    .gt('updated_at', since)
    .order('updated_at', { ascending: true });
  if (error) throw toSyncError(error);

  const rows = (data ?? []) as RawRow[];
  const changes = rows.map(rowToRecord);
  // New high-water mark: the largest updatedAt we are returning, floored at since.
  const token = changes.reduce((max, r) => Math.max(max, r.updatedAt), since);
  return { changes, token };
}

export async function push(changes: SyncRecord[]): Promise<PushResponse> {
  // Validate against the shared schema before we spend a round-trip; the server
  // re-validates with the SQL mirror (`validate_record`), so this is a fast-fail.
  for (const rec of changes) {
    const result = validateSyncRecord(rec);
    if (!result.ok) throw new SyncError(`invalid record ${rec.id}: ${result.reason}`, false);
  }
  const { data, error } = await getSupabase().rpc('push_records', { changes });
  if (error) throw toSyncError(error);
  return { results: (data ?? []) as PushResult[] };
}

/** The `SyncBackend` implementation the engine points its `defaultBackend` at. */
export const supabaseBackend = {
  pull: (since: number) => pull(since),
  push: (changes: SyncRecord[]) => push(changes),
};
