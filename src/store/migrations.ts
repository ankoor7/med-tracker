// Data migrations — pure, forward-only transforms applied to a loaded Dataset.
//
// These are *data* migrations (separate from Dexie's structural store
// versioning). Each migration takes a Dataset at version N-1 and returns one at
// version N. The runner applies every migration whose version exceeds the
// dataset's stored schema version, in order. Keep each transform pure and
// tested (Stage 2 FR-2.4).

import { newId } from '../core/ids';
import { buildScheduleSnapshot } from '../core/scheduleHistory';
import type { Dataset } from '../core/types';

export const CURRENT_SCHEMA_VERSION = 2;

export interface Migration {
  version: number; // the version this migration produces
  description: string;
  migrate(data: Dataset): Dataset;
}

/**
 * The instant a backfilled baseline snapshot takes effect: the epoch, meaning
 * "as far back as this dataset's history goes". Effective-dating only becomes
 * meaningful from the user's next edit onwards — we cannot reconstruct a regimen
 * that was never recorded — so the baseline deliberately claims all prior days,
 * which reproduces exactly the pre-Stage-18 rendering for them.
 */
export const BASELINE_SNAPSHOT_AT = 0;

/**
 * v2 (Stage 18 FR-18.1): seed the effective-dated snapshot log with a baseline
 * capturing the regimen as it stands at upgrade time.
 *
 * This is load-bearing, not cosmetic. Resolution falls back to the *earliest*
 * snapshot for dates before it; without a baseline, the user's first post-upgrade
 * edit would create the only snapshot, and every prior day would resolve to that
 * post-edit state — the very bug this stage fixes. Skipped when snapshots already
 * exist so the migration is idempotent.
 *
 * Medication `startedAt` is deliberately NOT backfilled: it is prompted for per
 * medication at upgrade time rather than inferred, and an absent `startedAt`
 * already means "treat as always prescribed".
 */
export const migrations: Migration[] = [
  {
    version: 2,
    description: 'Stage 18: baseline effective-dated schedule snapshot',
    migrate(data) {
      // `?? []` because an imported dataset may predate the field entirely.
      if ((data.scheduleSnapshots ?? []).length > 0) return data;
      return {
        ...data,
        scheduleSnapshots: [
          buildScheduleSnapshot(
            newId(),
            data.medications,
            data.slots,
            BASELINE_SNAPSHOT_AT,
            data.settings.zone,
          ),
        ],
      };
    },
  },
];

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
