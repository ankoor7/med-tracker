// Occurrence-linked side effects — pure domain core (Stage 24, P0 #5).
//
// Stage 15 event instances are standalone. Stage 24 lets the user *attribute*
// one to a medication (`medId`) and optionally to the specific logged dose
// (`doseLogEntryId`). This module owns the two pure pieces of that:
//   - FR-24.4: validating an attribution against the dataset (the cross-record
//     check SQL cannot do — `validate_record` is immutable and sees one record
//     at a time, exactly like the guardrail and event-value checks);
//   - FR-24.5: resolving the events attributed to a medication.
//
// Attribution is the user's **stated** association — the app never computes,
// infers or implies one, and nothing here asserts causation (surface, don't
// interpret). Like `core/guardrails.ts` and `core/events.ts`, the validator
// returns a list of human-readable messages (empty = valid) and never
// originates a value. No React/store/DOM imports.

import type { Dataset, EventInstance, Instant } from './types';

const live = (r: { deleted?: boolean }) => !r.deleted;

/**
 * The attribution fields of an event instance. Taken as a `Pick` of the entity
 * so a draft in the logger (which has no id/timestamps yet) can be validated
 * with the same function that validates a stored instance.
 */
export type EventAttribution = Pick<EventInstance, 'medId' | 'doseLogEntryId'>;

/**
 * A half-open instant range, `from` **inclusive** and `to` **exclusive** —
 * the same convention `clinicalReport.ts` uses to scope its period
 * (`occurredAt >= fromInstant && occurredAt < toExclusive`), so a day boundary
 * belongs to exactly one window and adjacent windows never double-count.
 */
export interface SideEffectWindow {
  from: Instant; // inclusive
  to: Instant; // exclusive
}

/**
 * Validate an event's attribution against the dataset (FR-24.4). Returns every
 * problem found, not just the first; an empty list means valid.
 *
 * The rules:
 *   - both fields absent → valid (an unattributed event, i.e. every
 *     pre-Stage-24 instance and every flare logged without a medication);
 *   - a `doseLogEntryId` requires a `medId` (spec §4: "A `doseLogEntryId`
 *     implies a `medId`"), so the attribution always names a medication;
 *   - a present `medId` must resolve to a non-deleted medication;
 *   - a present `doseLogEntryId` must resolve to a non-deleted dose-log entry;
 *   - when both resolve, the entry's own `medId` must equal the stated one.
 *
 * An **inactive** (`active: false`) medication is accepted: inactive means
 * retired, not gone, and a side effect attributed to a medication the user has
 * since stopped is precisely the clinically interesting case. Only `deleted`
 * (tombstoned) records are rejected.
 */
export function validateEventAttribution(
  dataset: Pick<Dataset, 'medications' | 'doseLog'>,
  attribution: EventAttribution,
): string[] {
  const { medId, doseLogEntryId } = attribution;
  if (medId === undefined && doseLogEntryId === undefined) return [];

  const errors: string[] = [];

  const med = medId === undefined ? undefined : dataset.medications.find((m) => m.id === medId);
  const medResolved = med !== undefined && live(med);
  if (medId !== undefined && !medResolved) {
    errors.push('The medication this event is attributed to no longer exists.');
  }

  if (doseLogEntryId === undefined) return errors;

  if (medId === undefined) {
    errors.push('Attributing an event to a dose also needs the medication that dose was for.');
  }

  const entry = dataset.doseLog.find((e) => e.id === doseLogEntryId);
  const entryResolved = entry !== undefined && live(entry);
  if (!entryResolved) {
    errors.push('The logged dose this event is attributed to no longer exists.');
  } else if (medResolved && entry.medId !== medId) {
    // Only meaningful once both sides resolve — comparing against a dangling
    // reference would just restate the error already reported above.
    errors.push('The logged dose this event is attributed to is for a different medication.');
  }

  return errors;
}

/**
 * The events the user has attributed to `medId` (FR-24.5), newest first
 * (`occurredAt` descending, ties broken by `id` so the order is total and
 * stable across runs). Optionally narrowed to `window`.
 *
 * What is excluded: deleted instances, and instances whose `EventType` is
 * deleted or missing from the dataset — matching `clinicalReport.ts`'s
 * `eventStats`, which skips an orphaned instance rather than inventing a type
 * for it. What is **included**: instances of an **archived** type. Archiving
 * hides a type from the active picker but keeps it resolvable and reversible
 * (see the `EventType.archived` comment in `types.ts`), and its history is the
 * whole point of the record.
 *
 * Every attributed event is returned regardless of the type's `category` — the
 * attribution is the user's statement about this event, and a flare they tie to
 * a medication is as reportable as a side effect.
 */
export function sideEffectsForMedication(
  dataset: Pick<Dataset, 'eventTypes' | 'eventInstances'>,
  medId: string,
  window?: SideEffectWindow,
): EventInstance[] {
  const liveTypeIds = new Set(dataset.eventTypes.filter(live).map((t) => t.id));

  return dataset.eventInstances
    .filter(
      (inst) =>
        live(inst) &&
        inst.medId === medId &&
        liveTypeIds.has(inst.typeId) &&
        (window === undefined || (inst.occurredAt >= window.from && inst.occurredAt < window.to)),
    )
    .sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id));
}
