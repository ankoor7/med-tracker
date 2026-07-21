// Adherence & missed-pattern detection — pure. PRD FR-HIS-2, FR-HIS-3.
//
// Counts *timing-sensitive* medications only (adjustWhenLate=true): flexible
// meds taken late are not adherence failures. The window is the last
// `adherenceWindowDays` calendar days (in the active zone) up to and including
// today. Only occurrences that are already past-due are scored.

import { timingSensitivePlannedForDate } from './scheduleHistory';
import { addDaysToIsoDate, isoDateInZone } from './time';
import type {
  DoseLogEntry,
  IanaZone,
  ISODate,
  Instant,
  Medication,
  ScheduleSnapshot,
  Slot,
} from './types';

export interface AdherenceResult {
  windowDays: number;
  from: ISODate;
  to: ISODate;
  expected: number; // past-due timing-sensitive occurrences
  taken: number;
  missed: number;
  ratio: number; // taken / expected (1 when nothing was expected)
  threshold: number;
  missedPatternWarning: boolean; // missed > threshold
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
): AdherenceResult {
  const source = { medications, slots, scheduleSnapshots };
  const today = isoDateInZone(now, zone);
  const from = addDaysToIsoDate(today, -(Math.max(1, windowDays) - 1));

  let expected = 0;
  let taken = 0;
  let missed = 0;

  for (let i = 0; i < windowDays; i++) {
    const date = addDaysToIsoDate(from, i);
    // Resolve the regimen as it stood on this day, then score only the
    // medications that were timing-sensitive *then* (FR-18.1 AC1/AC2). Scoring
    // against today's medication list is what made retiring a medication
    // retroactively erase its expected doses; the filter must therefore be
    // applied to the resolved list, not the current one.
    const planned = timingSensitivePlannedForDate(source, date, log, zone, now, assumeTakenOnTime);
    for (const slot of planned) {
      for (const occ of slot.occurrences) {
        if (occ.status === 'taken') {
          taken++;
          expected++;
        } else if (occ.status === 'missed') {
          missed++;
          expected++;
        }
        // 'upcoming' (future) and 'due' (flexible — filtered out here) are not scored.
      }
    }
  }

  const ratio = expected === 0 ? 1 : taken / expected;
  return {
    windowDays,
    from,
    to: today,
    expected,
    taken,
    missed,
    ratio,
    threshold: missedThreshold,
    missedPatternWarning: missed > missedThreshold,
  };
}
