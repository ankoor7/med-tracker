// Schedule enumeration — pure. See specs/02-architecture.md §6, PRD FR-SCH/FR-LOG-1.
//
// Resolves the fixed wall-clock schedule into concrete dated occurrences for a
// given day in the active zone, and tags each with a status by matching the
// dose log on (slotId, medId, scheduledInstant). Stage 5 will tighten the match
// with a tolerance window for mid-day zone changes (architecture §6).

import { resolveWallTimeToInstant } from './time';
import type {
  DoseLogEntry,
  IanaZone,
  ISODate,
  Instant,
  Medication,
  PlannedOccurrence,
  PlannedSlot,
  Slot,
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
): DoseLogEntry | undefined {
  return log.find(
    (e) =>
      !e.deleted &&
      e.status === 'taken' &&
      e.slotId === slotId &&
      e.medId === medId &&
      e.scheduledInstant === scheduledInstant,
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
 * Build the grouped, time-sorted slots for `date` (in `zone`), each with one
 * occurrence per active medication item, status-tagged against the log.
 */
export function plannedSlotsForDate(
  date: ISODate,
  slots: Slot[],
  medications: Medication[],
  log: DoseLogEntry[],
  zone: IanaZone,
  now: Instant,
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
      const entry = findLogEntry(log, slot.id, item.medId, scheduledInstant);
      occurrences.push({
        slotId: slot.id,
        medId: item.medId,
        scheduledInstant,
        time: slot.time,
        label: slot.label,
        dose: item.dose,
        status: occurrenceStatus(entry, scheduledInstant, now, med),
        logEntryId: entry?.id,
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
