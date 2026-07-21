// History & visualisation helpers — pure. See specs/stage-7-history-visualisation.md.
//
// Filtering and the adherence-over-time series are derived here from the
// canonical log/schedule in the active zone; the UI only renders. No
// pharmacology is computed (the level chart is fed solely by the extension).

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

export interface HistoryFilter {
  medId?: string; // undefined = all medications
  from?: ISODate; // inclusive local date
  to?: ISODate; // inclusive local date
}

/** Per-entry display markers, derived consistently for list + export. */
export interface EntryMarkers {
  adjusted: boolean;
  late: boolean;
  overCap: boolean;
}

/** A dose is "late" when taken more than a minute after its scheduled time. */
const LATE_MS = 60_000;

export function entryMarkers(entry: DoseLogEntry): EntryMarkers {
  return {
    adjusted: entry.adjusted,
    late: entry.actualInstant > entry.scheduledInstant + LATE_MS,
    overCap: entry.warnings.length > 0,
  };
}

/**
 * Filter the dose log by medication and an inclusive local-date range (resolved
 * in `zone`), newest first. Tombstoned entries are excluded.
 */
export function filterLog(
  log: DoseLogEntry[],
  filter: HistoryFilter,
  zone: IanaZone,
): DoseLogEntry[] {
  return log
    .filter((e) => !e.deleted)
    .filter((e) => (filter.medId ? e.medId === filter.medId : true))
    .filter((e) => {
      if (!filter.from && !filter.to) return true;
      const day = isoDateInZone(e.actualInstant, zone);
      if (filter.from && day < filter.from) return false;
      if (filter.to && day > filter.to) return false;
      return true;
    })
    .sort((a, b) => b.actualInstant - a.actualInstant);
}

export interface AdherenceDay {
  date: ISODate;
  taken: number;
  missed: number;
  expected: number; // past-due timing-sensitive occurrences (taken + missed)
}

/**
 * Per-day taken/missed counts for timing-sensitive meds over the last
 * `windowDays` days (in `zone`, ending today). Feeds the adherence chart;
 * mirrors `computeAdherence`'s scoring but keeps the daily breakdown.
 */
export function adherenceTimeline(
  slots: Slot[],
  medications: Medication[],
  log: DoseLogEntry[],
  zone: IanaZone,
  windowDays: number,
  now: Instant,
  assumeTakenOnTime = false,
  scheduleSnapshots: ScheduleSnapshot[] = [],
): AdherenceDay[] {
  const source = { medications, slots, scheduleSnapshots };
  const today = isoDateInZone(now, zone);
  const days = Math.max(1, windowDays);
  const from = addDaysToIsoDate(today, -(days - 1));

  const timeline: AdherenceDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysToIsoDate(from, i);
    // Same effective-dated resolution as `computeAdherence`, so the chart and
    // the summary figure can never disagree (FR-18.1).
    const planned = timingSensitivePlannedForDate(source, date, log, zone, now, assumeTakenOnTime);
    let taken = 0;
    let missed = 0;
    for (const slot of planned) {
      for (const occ of slot.occurrences) {
        if (occ.status === 'taken') taken++;
        else if (occ.status === 'missed') missed++;
      }
    }
    timeline.push({ date, taken, missed, expected: taken + missed });
  }
  return timeline;
}
