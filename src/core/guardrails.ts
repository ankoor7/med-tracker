// Guardrails — the single shared safety validator. PRD FR-GRD-1..3.
//
// The app never originates a dose; it records and validates. Every logged or
// suggested dose runs through `checkGuardrails`, which returns human-readable
// warning messages (empty array = within caps). Exceeding a cap does not block
// logging — the UI requires explicit confirmation and flags the entry.

import { hoursBetween, isoDateInZone } from './time';
import type { DoseLogEntry, IanaZone, Instant, Medication } from './types';

/**
 * Validate `dose` of `med` taken at `atInstant` against the med's guardrails,
 * given prior taken doses in `log`. Pure; no side effects.
 *
 * @returns ordered list of warning messages; empty if within all caps.
 */
export function checkGuardrails(
  med: Medication,
  dose: number,
  atInstant: Instant,
  log: DoseLogEntry[],
  zone: IanaZone,
): string[] {
  const warnings: string[] = [];
  const { maxSingleDose, maxDailyDose, minIntervalHours } = med.guardrails;

  // Prior *taken* doses of this med (exclude tombstones).
  const priorDoses = log.filter((e) => !e.deleted && e.status === 'taken' && e.medId === med.id);

  // Max single dose.
  if (maxSingleDose != null && dose > maxSingleDose) {
    warnings.push(`Exceeds max single dose (${dose}${med.unit} > ${maxSingleDose}${med.unit}).`);
  }

  // Max daily dose — sum of doses already taken on the same calendar day (in
  // the active zone) plus this dose.
  if (maxDailyDose != null) {
    const day = isoDateInZone(atInstant, zone);
    const dayTotal = priorDoses
      .filter((e) => isoDateInZone(e.actualInstant, zone) === day)
      .reduce((sum, e) => sum + e.dose, 0);
    const projected = dayTotal + dose;
    if (projected > maxDailyDose) {
      warnings.push(
        `Exceeds max daily dose (${projected}${med.unit} > ${maxDailyDose}${med.unit} today).`,
      );
    }
  }

  // Minimum interval since the most recent prior dose.
  if (minIntervalHours != null && priorDoses.length > 0) {
    const lastBefore = priorDoses
      .filter((e) => e.actualInstant <= atInstant)
      .reduce<Instant | null>(
        (latest, e) => (latest == null || e.actualInstant > latest ? e.actualInstant : latest),
        null,
      );
    if (lastBefore != null) {
      const gap = hoursBetween(lastBefore, atInstant);
      if (gap < minIntervalHours) {
        warnings.push(
          `Below min interval (${gap.toFixed(1)}h since last dose < ${minIntervalHours}h).`,
        );
      }
    }
  }

  return warnings;
}
