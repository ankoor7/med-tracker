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

// ---- Breach-kind classification (Stage 18 FR-18.10) ------------------------
//
// `checkGuardrails` returns plain warning strings — that shape is persisted
// verbatim on `DoseLogEntry.warnings` (see core/types.ts), so it cannot change.
// The acknowledgement button copy in the UI used to say "Log over-cap dose"
// unconditionally, which is wrong for a min-interval ("too soon") breach. This
// is a purely additive companion: it classifies an existing warning list by
// prefix so UI copy can name the actual violation.

export type GuardrailBreachKind = 'over-cap' | 'too-soon';

function warningKind(message: string): GuardrailBreachKind | 'other' {
  if (
    message.startsWith('Exceeds max single dose') ||
    message.startsWith('Exceeds max daily dose')
  ) {
    return 'over-cap';
  }
  if (message.startsWith('Below min interval')) return 'too-soon';
  return 'other';
}

/**
 * Classify a set of guardrail warning messages by breach kind.
 *
 * @returns `'over-cap'` if every warning is a max-single/max-daily breach,
 *   `'too-soon'` if every warning is a min-interval breach, or `null` if the
 *   warnings are empty, mixed, or of an unrecognised shape — callers should
 *   fall back to a generic "anyway" label in that case rather than guess.
 */
export function classifyGuardrailBreach(warnings: string[]): GuardrailBreachKind | null {
  if (warnings.length === 0) return null;
  const kinds = new Set(warnings.map(warningKind));
  if (kinds.size !== 1) return null;
  const only = [...kinds][0];
  return only === 'over-cap' || only === 'too-soon' ? only : null;
}

/**
 * Breach-kind-aware acknowledgement label, e.g. `guardrailAckLabel(w, 'Log')`
 * -> "Log over-cap dose" / "Log too-soon dose" / "Log dose anyway" (mixed or
 * unrecognised breach — a safe generic rather than a misleading specific one).
 */
export function guardrailAckLabel(warnings: string[], action: string): string {
  const kind = classifyGuardrailBreach(warnings);
  if (kind === 'over-cap') return `${action} over-cap dose`;
  if (kind === 'too-soon') return `${action} too-soon dose`;
  return `${action} dose anyway`;
}
