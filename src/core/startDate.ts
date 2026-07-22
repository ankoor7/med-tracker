// Medication start-date helpers — pure. Stage 18 FR-18.1 piece 3.
//
// `Medication.startedAt` is chosen by the user as a wall-clock calendar date in
// the active zone, never a raw instant the UI hand-rolls — these helpers convert
// through `core/time.ts` like everything else that crosses the wall-clock/instant
// boundary. They also flag the two "suspicious" cases named in the spec (a
// future start date; a start date after a dose is already logged) so the UI can
// warn. Neither case is rejected: the app records what the user tells it rather
// than second-guessing a fact about their own history, and both are easy to
// correct afterwards via the medication edit form.

import { isoDateInZone, resolveWallTimeToInstant } from './time';
import type { DoseLogEntry, IanaZone, ISODate, Instant, Medication } from './types';

/**
 * The instant a medication "started" on `date`, in `zone`: the start of that
 * calendar day. Using day-start (rather than "now") means the whole day counts
 * as started, matching how `resolveScheduleAsOf` compares against end-of-day.
 */
export function startOfDayInstant(date: ISODate, zone: IanaZone): Instant {
  return resolveWallTimeToInstant(date, '00:00', zone);
}

/** True when `date` (a calendar date in `zone`) is after today. */
export function isFutureStartDate(date: ISODate, now: Instant, zone: IanaZone): boolean {
  return date > isoDateInZone(now, zone);
}

/**
 * True when `medId` already has a non-deleted dose logged before `startedAt`.
 * That contradicts the claim "this medication started on `startedAt`" — worth
 * surfacing as a warning, though the app does not block on it (see
 * `core/startDate.ts` module doc).
 */
export function hasDoseLoggedBefore(
  doseLog: DoseLogEntry[],
  medId: string,
  startedAt: Instant,
): boolean {
  return doseLog.some((e) => !e.deleted && e.medId === medId && e.actualInstant < startedAt);
}

/**
 * Non-deleted medications missing a `startedAt` — the ones the one-off upgrade
 * prompt (Stage 18 FR-18.1 piece 3) asks about. A fresh install's seed data
 * stamps `startedAt` on every medication, so this is empty on first run; it
 * only returns entries for a dataset that predates the field.
 */
export function medicationsMissingStartDate(medications: Medication[]): Medication[] {
  return medications.filter((m) => !m.deleted && m.startedAt == null);
}

/** True when {@link medicationsMissingStartDate} would return anything. */
export function needsStartDatePrompt(medications: Medication[]): boolean {
  return medicationsMissingStartDate(medications).length > 0;
}
