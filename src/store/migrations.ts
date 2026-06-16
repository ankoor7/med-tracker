// Data migrations — pure, forward-only transforms applied to a loaded Dataset.
//
// These are *data* migrations (separate from Dexie's structural store
// versioning). Each migration takes a Dataset at version N-1 and returns one at
// version N. The runner applies every migration whose version exceeds the
// dataset's stored schema version, in order. Keep each transform pure and
// tested (Stage 2 FR-2.4).

import type { Dataset } from '../core/types';

export const CURRENT_SCHEMA_VERSION = 1;

export interface Migration {
  version: number; // the version this migration produces
  description: string;
  migrate(data: Dataset): Dataset;
}

// No data migrations yet — v1 is the initial schema. Future versions append a
// Migration here (e.g. backfilling a new field). The runner and tests already
// exercise the mechanism so the first real migration is low-risk.
export const migrations: Migration[] = [];

/**
 * Apply every migration with `version > fromVersion`, in ascending order.
 * Returns the migrated dataset and the resulting schema version.
 */
export function runMigrations(
  data: Dataset,
  fromVersion: number,
  steps: Migration[] = migrations,
): { data: Dataset; version: number } {
  const pending = steps
    .filter((m) => m.version > fromVersion)
    .sort((a, b) => a.version - b.version);

  let result = data;
  let version = fromVersion;
  for (const step of pending) {
    result = step.migrate(result);
    version = step.version;
  }
  // Never report a version below the code's current schema version.
  return { data: result, version: Math.max(version, fromVersion) };
}
