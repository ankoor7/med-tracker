// Schedule enumeration — pure. See specs/02-architecture.md §6, PRD FR-SCH/FR-LOG-1.
//
// Resolves the fixed wall-clock schedule into concrete dated occurrences for a
// given day in the active zone, and tags each with a status by matching the
// dose log on (slotId, medId, scheduledInstant). Stage 5 will tighten the match
// with a tolerance window for mid-day zone changes (architecture §6).

import { addDaysToIsoDate, isoDateInZone, resolveWallTimeToInstant } from './time';
import { entryMatchesOccurrence, overrideMatchesOccurrence } from './occurrence';
import type {
  DoseLogEntry,
  DoseOverride,
  IanaZone,
  ISODate,
  Instant,
  Medication,
  PlannedOccurrence,
  PlannedSlot,
  Slot,
  WallTime,
} from './types';

function activeMed(meds: Map<string, Medication>, medId: string): Medication | undefined {
  const med = meds.get(medId);
  if (!med || med.deleted || !med.active) return undefined;
  return med;
}

function findLogEntry(
  log: DoseLogEntry[],
  slotId: string,
  medId: string,
  scheduledInstant: Instant,
  date: ISODate,
): DoseLogEntry | undefined {
  // Match on the occurrence key (slotId, medId, localDate) so a dose stays mapped
  // to its slot across a mid-day zone change (FR-5.6), not bare instant equality.
  return log.find(
    (e) =>
      !e.deleted &&
      e.status === 'taken' &&
      entryMatchesOccurrence(e, slotId, medId, scheduledInstant, date),
  );
}

function occurrenceStatus(
  entry: DoseLogEntry | undefined,
  scheduledInstant: Instant,
  now: Instant,
  med: Medication,
): PlannedOccurrence['status'] {
  if (entry) return 'taken';
  if (scheduledInstant > now) return 'upcoming';
  // Past and untaken: timing-sensitive meds are an alert ("missed"); flexible
  // meds are merely "due" (PRD FR-MED-2, Stage 1 AC6).
  return med.adjustWhenLate ? 'missed' : 'due';
}

/**
 * The newest non-deleted override that applies to an occurrence, or undefined.
 */
function findOverride(
  overrides: DoseOverride[],
  slotId: string,
  medId: string,
  scheduledInstant: Instant,
  date: ISODate,
): DoseOverride | undefined {
  let best: DoseOverride | undefined;
  for (const o of overrides) {
    if (o.deleted) continue;
    if (!overrideMatchesOccurrence(o, slotId, medId, scheduledInstant, date)) continue;
    if (!best || o.updatedAt > best.updatedAt) best = o;
  }
  return best;
}

/**
 * Build the grouped, time-sorted slots for `date` (in `zone`), each with one
 * occurrence per active medication item, status-tagged against the log. A
 * one-time `DoseOverride` (Stage 12) replaces the planned dose of an as-yet
 * untaken occurrence; `overrides` defaults to none.
 */
export function plannedSlotsForDate(
  date: ISODate,
  slots: Slot[],
  medications: Medication[],
  log: DoseLogEntry[],
  zone: IanaZone,
  now: Instant,
  overrides: DoseOverride[] = [],
): PlannedSlot[] {
  const meds = new Map(medications.map((m) => [m.id, m]));

  const planned: PlannedSlot[] = [];
  for (const slot of slots) {
    if (slot.deleted) continue;
    const scheduledInstant = resolveWallTimeToInstant(date, slot.time, zone);

    const occurrences: PlannedOccurrence[] = [];
    for (const item of slot.items) {
      const med = activeMed(meds, item.medId);
      if (!med) continue;
      const entry = findLogEntry(log, slot.id, item.medId, scheduledInstant, date);
      const status = occurrenceStatus(entry, scheduledInstant, now, med);
      // Apply a one-time override only while the occurrence is still untaken.
      const override =
        status === 'taken'
          ? undefined
          : findOverride(overrides, slot.id, item.medId, scheduledInstant, date);
      occurrences.push({
        slotId: slot.id,
        medId: item.medId,
        scheduledInstant,
        time: slot.time,
        label: slot.label,
        dose: override ? override.dose : item.dose,
        status,
        logEntryId: entry?.id,
        ...(override ? { overridden: true, overrideId: override.id } : {}),
      });
    }

    if (occurrences.length === 0) continue;
    planned.push({
      slotId: slot.id,
      time: slot.time,
      label: slot.label,
      scheduledInstant,
      occurrences,
    });
  }

  planned.sort((a, b) => a.scheduledInstant - b.scheduledInstant);
  return planned;
}

/** The next scheduled occurrence of one med, for targeting an override (Stage 12). */
export interface NextOccurrence {
  slotId: string;
  medId: string;
  scheduledInstant: Instant;
  time: WallTime;
  label?: string;
  dose: number; // the slot's normal dose for this med
}

/**
 * The next scheduled occurrence of `medId` strictly after `afterInstant`, scanning
 * forward over up to `daysAhead` calendar days (in `zone`). Returns undefined if
 * the med is inactive/absent or has no upcoming slot. Pure.
 */
export function nextOccurrenceForMed(
  medId: string,
  afterInstant: Instant,
  slots: Slot[],
  medications: Medication[],
  zone: IanaZone,
  daysAhead = 7,
): NextOccurrence | undefined {
  const meds = new Map(medications.map((m) => [m.id, m]));
  if (!activeMed(meds, medId)) return undefined;

  const startDate = isoDateInZone(afterInstant, zone);
  let best: NextOccurrence | undefined;
  for (let d = 0; d <= daysAhead; d++) {
    const date = addDaysToIsoDate(startDate, d);
    for (const slot of slots) {
      if (slot.deleted) continue;
      const item = slot.items.find((i) => i.medId === medId);
      if (!item) continue;
      const scheduledInstant = resolveWallTimeToInstant(date, slot.time, zone);
      if (scheduledInstant <= afterInstant) continue;
      if (!best || scheduledInstant < best.scheduledInstant) {
        best = {
          slotId: slot.id,
          medId,
          scheduledInstant,
          time: slot.time,
          label: slot.label,
          dose: item.dose,
        };
      }
    }
    // Once we have a hit on day d, no later day can beat it.
    if (best) break;
  }
  return best;
}
