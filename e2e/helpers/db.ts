// Direct Postgres access for E2E DB assertions (Stage 10).
//
// The suite connects to the local Supabase Postgres so it can clear state for
// deterministic re-runs and read back the `records` rows that the app's sync
// engine wrote via the `push_records` RPC. Asserting this table proves the full
// UI -> store -> sync -> PostgREST/RPC -> Postgres round-trip.

import { Pool } from 'pg';

// The standard local Supabase DB URL (see `supabase status`). Overridable for
// non-default setups; never a real secret (local-only postgres:postgres).
const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export const DEV_EMAIL = 'dev@steadydose.local';
export const DEV_PASSWORD = 'DevPassw0rd!';

// Lazy singleton pool. Specs run in one worker and each closes the pool in its
// afterAll; recreating on demand makes that order-independent (a later spec just
// reopens it) instead of failing on a closed shared pool.
let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: DB_URL });
  return pool;
}

export interface RecordRow {
  id: string;
  type:
    'medication' | 'slot' | 'doseLog' | 'doseOverride' | 'eventType' | 'eventInstance' | 'settings';
  updated_at: string; // bigint comes back as a string from node-pg
  version: number;
  deleted: boolean;
  payload: Record<string, unknown>;
}

/** Resolve the seeded dev user's id by email (seeded in supabase/seed.sql). */
export async function getUserId(email = DEV_EMAIL): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    'select id from auth.users where email = $1',
    [email],
  );
  if (rows.length === 0) {
    throw new Error(
      `Dev user ${email} not found. Run \`pnpm local:reset\` to apply migrations + seed.`,
    );
  }
  return rows[0]!.id;
}

/** Delete all of a user's records — call before each test for isolation. */
export async function clearUserRecords(userId: string): Promise<void> {
  await getPool().query('delete from records where user_id = $1', [userId]);
}

/** Read a user's records, optionally filtered by type, ordered by id. */
export async function getRecords(userId: string, type?: RecordRow['type']): Promise<RecordRow[]> {
  const sql = type
    ? 'select id, type, updated_at, version, deleted, payload from records where user_id = $1 and type = $2 order by id'
    : 'select id, type, updated_at, version, deleted, payload from records where user_id = $1 order by id';
  const params = type ? [userId, type] : [userId];
  const { rows } = await getPool().query<RecordRow>(sql, params);
  return rows;
}

/** Quick reachability probe used by global setup. */
export async function ping(): Promise<void> {
  await getPool().query('select 1');
}

/** Close the pool (idempotent); a later spec lazily reopens it via getPool(). */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}
