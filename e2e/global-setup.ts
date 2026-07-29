// Fail fast with an actionable message if the local Supabase stack isn't up,
// rather than letting specs time out against an unreachable backend.

import { getUserId, ping, closePool } from './helpers/db';

export default async function globalSetup(): Promise<void> {
  try {
    await ping();
    await getUserId(); // also confirms migrations + seed have been applied
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `E2E setup: cannot reach the local Supabase stack (${reason}).\n` +
        'Start it first:  pnpm local:up   (then  pnpm local:env)\n' +
        'Reset it if the dev user/migrations are missing:  pnpm local:reset',
      { cause: err },
    );
  } finally {
    await closePool();
  }
}
