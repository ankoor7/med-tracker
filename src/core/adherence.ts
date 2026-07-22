// Adherence & missed-pattern detection — pure. PRD FR-HIS-2, FR-HIS-3.
//
// Counts *timing-sensitive* medications only (adjustWhenLate=true): flexible
// meds taken late are not adherence failures. The window is the last
// `adherenceWindowDays` calendar days (in the active zone) up to and including
// today. Only occurrences that are already past-due are scored.
//
// Stage 18 FR-18.4 (lateness-aware adherence): a timing-sensitive dose logged
// outside the global `onTimeWindowMinutes` window is "late" — still taken, but
// no longer counted as "on time" and no longer inflating the headline ratio.
// A dose that is 15h30m or 3h30m late must not read as 100% adherent (the
// Journey 3 regression this closes).
//
// Stage 18 FR-18.3 (skipped doses): a deliberately withheld dose is reported as
// its own outcome, distinct from both "taken" and "missed". It is NOT scored
// against `expected`/`ratio` — a clinician-directed skip is a deliberate
// decision about that dose, not a lapse the adherence figure should penalise,
// and folding it into "missed" would put it in a GP-facing report (Stage 17)
// indistinguishable from a forgotten dose. It also never counts toward the
// missed-pattern warning, for the same reason. It is still fully visible via
// the `skipped` count.

import { timingSensitivePlannedForDate } from './scheduleHistory';
import { addDaysToIsoDate, isoDateInZone } from './time';
import type {
  DoseLogEntry,
  IanaZone,
  ISODate,
  Instant,
  Medication,
  PlannedOccurrence,
  PlannedSlot,
  ScheduleSnapshot,
  Slot,
} from './types';

/**
 * Default global on-time window (Stage 18 FR-18.4 §7 item 2 — settled as a
 * single global setting, no per-medication override). One hour is generous:
 * it absorbs ordinary daily-life slack (a delayed commute, a late lunch)
 * without reading as punitive, while still being far short of the multi-hour
 * lateness (15h30m, 3h30m) that produced the fabricated 100% figure this FR
 * fixes. The user can widen or tighten it in History → Settings.
 */
export const DEFAULT_ON_TIME_WINDOW_MINUTES = 60;

export interface AdherenceResult {
  windowDays: number;
  from: ISODate;
  to: ISODate;
  onTimeWindowMinutes: number; // the window used, for a transparent "basis" statement
  expected: number; // past-due timing-sensitive occurrences: onTime + late + missed
  onTime: number; // taken within the on-time window
  late: number; // taken, but outside the on-time window — still "taken", never "missed"
  missed: number;
  skipped: number; // deliberately withheld — reported, excluded from expected/ratio
  taken: number; // onTime + late — total doses actually logged as taken
  ratio: number; // onTime / expected (1 when nothing was expected)
  threshold: number;
  missedPatternWarning: boolean; // missed > threshold (skipped never counts here)
}

/** Per-day/window outcome tally shared by `computeAdherence` and `adherenceTimeline`. */
export interface OutcomeCounts {
  onTime: number;
  late: number;
  missed: number;
  skipped: number;
}

/**
 * Classify a set of already timing-sensitive planned occurrences (from
 * `timingSensitivePlannedForDate`) into on-time / late / missed / skipped,
 * using the dose log to find the actual time a "taken" occurrence was logged.
 * Shared by `computeAdherence` and `adherenceTimeline` so the summary figure
 * and the chart can never disagree — mirrors why `timingSensitivePlannedForDate`
 * itself is shared (FR-18.1). Do not inline this at either call site.
 */
/**
 * A "taken" occurrence is on time unless a real (non-assumed) log entry shows
 * it was logged outside `windowMs` of its scheduled time. Assumed-taken (no
 * real entry, filled in by the assume-on-time policy) is on time by
 * definition — there is nothing else to assume. Extracted from
 * `classifyOccurrences` to keep that function's branching flat.
 */
function classifyTakenDelay(
  occ: PlannedOccurrence,
  logById: Map<string, DoseLogEntry>,
  windowMs: number,
): 'onTime' | 'late' {
  const entry = occ.assumed || !occ.logEntryId ? undefined : logById.get(occ.logEntryId);
  const delay = entry ? entry.actualInstant - occ.scheduledInstant : 0;
  return delay > windowMs ? 'late' : 'onTime';
}

export function classifyOccurrences(
  planned: PlannedSlot[],
  log: DoseLogEntry[],
  onTimeWindowMinutes: number,
): OutcomeCounts {
  const logById = new Map(log.filter((e) => !e.deleted).map((e) => [e.id, e]));
  const windowMs = onTimeWindowMinutes * 60_000;
  const counts: OutcomeCounts = { onTime: 0, late: 0, missed: 0, skipped: 0 };

  for (const slot of planned) {
    for (const occ of slot.occurrences) {
      if (occ.status === 'skipped') {
        counts.skipped++;
      } else if (occ.status === 'missed') {
        counts.missed++;
      } else if (occ.status === 'taken') {
        counts[classifyTakenDelay(occ, logById, windowMs)]++;
      }
      // 'upcoming' (future) and 'due' (flexible — already filtered out) are not scored.
    }
  }
  return counts;
}

export function computeAdherence(
  slots: Slot[],
  medications: Medication[],
  log: DoseLogEntry[],
  zone: IanaZone,
  windowDays: number,
  missedThreshold: number,
  now: Instant,
  assumeTakenOnTime = false,
  scheduleSnapshots: ScheduleSnapshot[] = [],
  onTimeWindowMinutes: number = DEFAULT_ON_TIME_WINDOW_MINUTES,
): AdherenceResult {
  const source = { medications, slots, scheduleSnapshots };
  const today = isoDateInZone(now, zone);
  const from = addDaysToIsoDate(today, -(Math.max(1, windowDays) - 1));

  let onTime = 0;
  let late = 0;
  let missed = 0;
  let skipped = 0;

  for (let i = 0; i < windowDays; i++) {
    const date = addDaysToIsoDate(from, i);
    // Resolve the regimen as it stood on this day, then score only the
    // medications that were timing-sensitive *then* (FR-18.1 AC1/AC2). Scoring
    // against today's medication list is what made retiring a medication
    // retroactively erase its expected doses; the filter must therefore be
    // applied to the resolved list, not the current one.
    const planned = timingSensitivePlannedForDate(source, date, log, zone, now, assumeTakenOnTime);
    const day = classifyOccurrences(planned, log, onTimeWindowMinutes);
    onTime += day.onTime;
    late += day.late;
    missed += day.missed;
    skipped += day.skipped;
  }

  const taken = onTime + late;
  const expected = taken + missed;
  const ratio = expected === 0 ? 1 : onTime / expected;
  return {
    windowDays,
    from,
    to: today,
    onTimeWindowMinutes,
    expected,
    onTime,
    late,
    missed,
    skipped,
    taken,
    ratio,
    threshold: missedThreshold,
    missedPatternWarning: missed > missedThreshold,
  };
}
