// Effective-dated schedule resolution — pure. Stage 18 FR-18.1, spec §4.
//
// The defect this closes: every screen used to project every day, past and
// future, by reapplying the *current* configuration. Raising a dose today
// rewrote yesterday; retiring a medication erased it from last week's adherence.
//
// The fix: the store captures a `ScheduleSnapshot` of the whole regimen after
// every mutating action. Resolving day D selects the snapshot that was in effect
// on that day, and the enumerator runs against that instead of today's config.
//
// Why snapshots rather than reversing `RegimenChange` diffs (spec §4 option (a)):
// the Stage 16 diffs are display strings keyed by medication *name*, the
// hard-delete path drops the affected slot items entirely, and `medication-added`
// does not distinguish a create from a reactivation. Historical fidelity must not
// depend on a diff being complete and losslessly reversible.

import { plannedSlotsForDate } from './schedule';
import { addDaysToIsoDate, resolveWallTimeToInstant } from './time';
import type {
  DoseLogEntry,
  DoseOverride,
  IanaZone,
  ISODate,
  Instant,
  Medication,
  PlannedSlot,
  ScheduleSnapshot,
  Slot,
} from './types';

/**
 * The minimum a caller must supply to resolve history: the current regimen plus
 * the snapshot log. `Dataset` satisfies this structurally.
 */
export interface RegimenSource {
  medications: Medication[];
  slots: Slot[];
  scheduleSnapshots: ScheduleSnapshot[];
}

export interface ResolvedSchedule {
  date: ISODate;
  medications: Medication[];
  slots: Slot[];
  /**
   * The snapshot the schedule came from, or undefined when it came from the
   * current configuration (no snapshots recorded — see `resolveScheduleAsOf`).
   */
  snapshotId?: string;
}

/**
 * The first instant of the day *after* `date` in `zone` — the exclusive upper
 * bound of that calendar day. Derived through `resolveWallTimeToInstant` so DST
 * transitions (including days that are 23 or 25 hours long) are handled by the
 * same zone math as the rest of the core.
 */
function endOfDayExclusive(date: ISODate, zone: IanaZone): Instant {
  return resolveWallTimeToInstant(addDaysToIsoDate(date, 1), '00:00', zone);
}

/**
 * Deterministic ordering for snapshots taken at the same instant: `effectiveFrom`
 * ascending, then `updatedAt`, then `id`. Sync merges do not preserve array
 * order, so resolution must not depend on it.
 *
 * The `id` tiebreak is kept deliberately. It used to be load-bearing and wrong:
 * one snapshot per store action meant a single Save produced several snapshots
 * in the same millisecond, and this comparator picked between them by UUID — so
 * a past day could render an intermediate regimen the user never saved. That is
 * fixed at the source (the store now collapses a bracketed edit into one
 * snapshot, so a single edit cannot tie with itself), not here.
 *
 * What remains is the genuinely ambiguous case: two *different* devices editing
 * within the same millisecond and later syncing. There is no shared array order
 * and no happens-before relation to recover, so any choice is arbitrary — but it
 * must be the SAME arbitrary choice on every device, or two phones would render
 * different histories from identical data. Ordering by id gives exactly that.
 * Dropping it would make `sort` fall back to input order, i.e. sync arrival
 * order, which differs per device. Keep.
 */
function byEffectiveFrom(a: ScheduleSnapshot, b: ScheduleSnapshot): number {
  if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom - b.effectiveFrom;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * True when `med` was already prescribed at some point during `date`. A
 * medication with no `startedAt` is treated as having always existed, so nothing
 * regresses for datasets written before the field existed (FR-18.1 / AC3).
 */
function startedByDate(med: Medication, dayEnd: Instant): boolean {
  return med.startedAt == null || med.startedAt < dayEnd;
}

/**
 * The regimen in effect on `date` (a calendar day in `zone`).
 *
 * Selection: the snapshot with the greatest `effectiveFrom` that falls at or
 * before the end of that day — so a change made *on* day D applies to D, and
 * days before D keep the regimen they were actually rendered with. Today and
 * future dates therefore resolve to the newest snapshot, which is the current
 * configuration.
 *
 * Fallbacks, both meaning "we have no record, so do not invent a change":
 * - no snapshots at all (a dataset predating Stage 18) → the current
 *   configuration, i.e. exactly the old behaviour;
 * - a date before the earliest snapshot → that earliest snapshot, so history
 *   stays monotone rather than jumping back to today's config.
 *
 * `startedAt` is applied on top from the *current* medication list, because it
 * is a retroactive statement about when a medication was first prescribed:
 * medications not yet started on `date` are dropped, along with any slot left
 * with no items. Pure.
 */
export function resolveScheduleAsOf(
  source: RegimenSource,
  date: ISODate,
  zone: IanaZone,
): ResolvedSchedule {
  const dayEnd = endOfDayExclusive(date, zone);

  const live = source.scheduleSnapshots.filter((s) => !s.deleted).sort(byEffectiveFrom);
  let snapshot: ScheduleSnapshot | undefined;
  for (const candidate of live) {
    if (candidate.effectiveFrom < dayEnd) snapshot = candidate;
    else break; // sorted ascending: no later snapshot can apply either
  }
  // Before the earliest snapshot, hold the earliest rather than falling through
  // to the current config (which would render a change that never happened).
  if (!snapshot && live.length > 0) snapshot = live[0];

  const medications = snapshot ? snapshot.medications : source.medications;
  const slots = snapshot ? snapshot.slots : source.slots;

  // `startedAt` is authoritative from the current record, not the snapshot copy.
  const currentById = new Map(source.medications.map((m) => [m.id, m]));
  const startedAtFor = (med: Medication): Medication => {
    const current = currentById.get(med.id);
    return current && current.startedAt !== med.startedAt
      ? { ...med, startedAt: current.startedAt }
      : med;
  };

  const resolvedMeds = medications.map(startedAtFor).filter((m) => startedByDate(m, dayEnd));
  const availableIds = new Set(resolvedMeds.map((m) => m.id));
  const resolvedSlots = slots
    // A slot tombstoned before this snapshot was taken is still carried in the
    // snapshot's `slots` array; it must not come back as a live occurrence.
    // Every current caller pipes this into `plannedSlotsForDate`, which filters
    // tombstones again, so nothing double-rendered — but the contract of this
    // function is "the regimen in effect", and a deleted slot was not in it.
    .filter((slot) => !slot.deleted)
    .map((slot) => {
      const items = slot.items.filter((i) => availableIds.has(i.medId));
      return items.length === slot.items.length ? slot : { ...slot, items };
    })
    .filter((slot) => slot.items.length > 0);

  return {
    date,
    medications: resolvedMeds,
    slots: resolvedSlots,
    ...(snapshot ? { snapshotId: snapshot.id } : {}),
  };
}

/**
 * Enumerate `date`'s occurrences against the regimen that was actually in effect
 * on that day. This is the historically-faithful counterpart to
 * `plannedSlotsForDate` and the entry point every read path should use; the
 * bare enumerator remains available for callers that already hold a resolved
 * regimen (or deliberately want the current one, e.g. future reminders).
 */
export function plannedSlotsAsOf(
  source: RegimenSource,
  date: ISODate,
  log: DoseLogEntry[],
  zone: IanaZone,
  now: Instant,
  overrides: DoseOverride[] = [],
  assumeTakenOnTime = false,
): PlannedSlot[] {
  const resolved = resolveScheduleAsOf(source, date, zone);
  return plannedSlotsForDate(
    date,
    resolved.slots,
    resolved.medications,
    log,
    zone,
    now,
    overrides,
    assumeTakenOnTime,
  );
}

/**
 * Timing-sensitive occurrences for `date`, resolved against the regimen that
 * was actually in effect on that day (rather than today's configuration).
 * Shared by `computeAdherence` and `adherenceTimeline` so the summary figure
 * and the chart can never disagree (FR-18.1) — do not inline this at either
 * call site; keep them in lockstep through this function instead.
 */
export function timingSensitivePlannedForDate(
  source: RegimenSource,
  date: ISODate,
  log: DoseLogEntry[],
  zone: IanaZone,
  now: Instant,
  assumeTakenOnTime = false,
): PlannedSlot[] {
  const resolved = resolveScheduleAsOf(source, date, zone);
  return plannedSlotsForDate(
    date,
    resolved.slots,
    resolved.medications.filter((m) => m.adjustWhenLate),
    log,
    zone,
    now,
    [],
    assumeTakenOnTime,
  );
}

/**
 * Capture the current regimen as a snapshot taking effect at `at`. The store
 * calls this after every mutating action; `id` is supplied by the caller so this
 * stays pure.
 */
export function buildScheduleSnapshot(
  id: string,
  medications: Medication[],
  slots: Slot[],
  at: Instant,
  zone: IanaZone,
): ScheduleSnapshot {
  return {
    id,
    effectiveFrom: at,
    zone,
    // Copy: a snapshot must not alias live records that later mutate.
    medications: medications.map((m) => ({ ...m })),
    slots: slots.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) })),
    updatedAt: at,
  };
}
