// Stage 18 FR-18.12 — planning the slot edits implied by a medication-centric
// editor.
//
// The merged Meds tab lets a user edit a medication and the times/doses it is
// taken at in one form. `Medication` and `Slot` remain separate entities, so
// that form's "times" list has to be projected back onto the existing slots as
// a sequence of ordinary store mutations. This module is the pure part of that
// translation: given the rows the user left in the form, it says which slots to
// add, update or remove. The store actions themselves are untouched, so the
// Stage 16 change records each edit emits are identical to those produced by
// the old two-tab flow.

import type { ScheduleItem, Slot } from './types';

/** One row of the medication editor's "times & doses" list. */
export interface MedTimeRow {
  /** Present when the row came from an existing slot; absent for a new time. */
  slotId?: string;
  /** Wall-clock "HH:MM" in the active zone. */
  time: string;
  dose: number;
}

export type SlotOp =
  | { kind: 'add-slot'; time: string; item: ScheduleItem }
  | { kind: 'update-slot'; slotId: string; patch: { time?: string; items?: ScheduleItem[] } }
  | { kind: 'delete-slot'; slotId: string };

const live = (s: Slot) => !s.deleted;

/** The non-deleted slots that currently schedule `medId`, in time order. */
export function slotsForMedication(slots: Slot[], medId: string): Slot[] {
  return slots
    .filter((s) => live(s) && s.items.some((i) => i.medId === medId))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** The editor rows that represent a medication's current schedule. */
export function rowsForMedication(slots: Slot[], medId: string): MedTimeRow[] {
  return slotsForMedication(slots, medId).map((s) => ({
    slotId: s.id,
    time: s.time,
    dose: s.items.find((i) => i.medId === medId)?.dose ?? 0,
  }));
}

/**
 * Translate the editor's rows into store mutations.
 *
 * - A row whose time or dose changed produces one `update-slot` carrying only
 *   the fields that actually differ — so a dose-only edit is indistinguishable
 *   from the same edit made in the old per-slot editor.
 * - A removed row detaches the medication from its slot, and tombstones the
 *   slot only when nothing else was scheduled there.
 * - A new row joins an existing slot at the same wall-clock time when one
 *   exists (keeping doses grouped as the user sees them on Today), otherwise
 *   creates a slot.
 *
 * Rows with a non-positive dose or a malformed time are ignored; the editor
 * blocks saving in that state, this is belt-and-braces.
 *
 * Caller contract: `rows` must not contain two rows targeting the same time —
 * use `duplicateTimes()` to check, as `MedicationEditor` does to gate saving.
 * Two rows aiming at one slot would each plan an `update-slot` against the same
 * pre-plan state, and because `updateSlot` replaces `items` wholesale against
 * *current* state, whichever applied second would clobber the first.
 */
export function planSlotOps(medId: string, rows: MedTimeRow[], slots: Slot[]): SlotOp[] {
  const valid = rows.filter((r) => isValidTime(r.time) && r.dose > 0);
  return [
    ...planEdits(medId, valid, slots),
    ...planRemovals(medId, valid, slots),
    ...planAdditions(medId, valid, slots),
  ];
}

/** Rows still bound to a slot: time and/or dose edits. */
function planEdits(medId: string, rows: MedTimeRow[], slots: Slot[]): SlotOp[] {
  const byId = new Map(slots.filter(live).map((s) => [s.id, s]));
  const ops: SlotOp[] = [];
  for (const row of rows) {
    const slot = row.slotId == null ? undefined : byId.get(row.slotId);
    if (!slot) continue;
    const target = slot.time === row.time ? undefined : occupantAt(slots, row.time, medId, slot.id);
    ops.push(...(target ? planMove(medId, row, slot, target) : planInPlaceEdit(medId, row, slot)));
  }
  return ops;
}

/** A time/dose edit that stays within the row's own slot. */
function planInPlaceEdit(medId: string, row: MedTimeRow, slot: Slot): SlotOp[] {
  const patch: { time?: string; items?: ScheduleItem[] } = {};
  if (slot.time !== row.time) patch.time = row.time;
  if (slot.items.find((i) => i.medId === medId)?.dose !== row.dose) {
    patch.items = upsertItem(slot.items, { medId, dose: row.dose });
  }
  return patch.time != null || patch.items != null
    ? [{ kind: 'update-slot', slotId: slot.id, patch }]
    : [];
}

/**
 * Retiming onto a time another slot already occupies.
 *
 * Moving the *source* slot's time would fork a second live slot at the same
 * wall-clock time, splitting doses the user sees as one group on Today and
 * contradicting what the editor tells them — that a time belongs to the slot.
 * So the medication moves instead: detached from the source (tombstoning it only
 * when nothing else is left, the same rule removals use) and added to the
 * occupant. Two slots really did change, so this honestly emits two ordinary
 * store mutations rather than one synthetic record.
 */
function planMove(medId: string, row: MedTimeRow, source: Slot, target: Slot): SlotOp[] {
  return [
    detach(medId, source),
    {
      kind: 'update-slot',
      slotId: target.id,
      patch: { items: upsertItem(target.items, { medId, dose: row.dose }) },
    },
  ];
}

/** Drop `medId` from `slot`, tombstoning it only when nothing else is left. */
function detach(medId: string, slot: Slot): SlotOp {
  const remaining = slot.items.filter((i) => i.medId !== medId);
  return remaining.length === 0
    ? { kind: 'delete-slot', slotId: slot.id }
    : { kind: 'update-slot', slotId: slot.id, patch: { items: remaining } };
}

/**
 * The live slot already sitting at `time`, if any — the one a row moving there
 * should join. Slots already holding `medId` are skipped: that is the
 * medication's own other row (a swap), not a slot to merge into.
 */
function occupantAt(
  slots: Slot[],
  time: string,
  medId: string,
  exceptId?: string,
): Slot | undefined {
  return slots.find(
    (s) =>
      live(s) && s.id !== exceptId && s.time === time && !s.items.some((i) => i.medId === medId),
  );
}

/** Slots the medication was dropped from; tombstoned only when left empty. */
function planRemovals(medId: string, rows: MedTimeRow[], slots: Slot[]): SlotOp[] {
  const kept = new Set(rows.map((r) => r.slotId).filter((id): id is string => id != null));
  return slotsForMedication(slots, medId)
    .filter((s) => !kept.has(s.id))
    .map((s) => detach(medId, s));
}

/** New times: join an existing slot at that wall-clock time, or create one. */
function planAdditions(medId: string, rows: MedTimeRow[], slots: Slot[]): SlotOp[] {
  return rows
    .filter((r) => r.slotId == null)
    .map((row) => {
      const target = occupantAt(slots, row.time, medId);
      return target
        ? {
            kind: 'update-slot' as const,
            slotId: target.id,
            patch: { items: upsertItem(target.items, { medId, dose: row.dose }) },
          }
        : { kind: 'add-slot' as const, time: row.time, item: { medId, dose: row.dose } };
    });
}

function upsertItem(items: ScheduleItem[], item: ScheduleItem): ScheduleItem[] {
  return items.some((i) => i.medId === item.medId)
    ? items.map((i) => (i.medId === item.medId ? { ...i, dose: item.dose } : i))
    : [...items, item];
}

/** Who a row will share its time with once saved, and whether that is new. */
export interface SharedTime {
  medIds: string[];
  /** True when saving will move the medication into a slot it is not in yet. */
  joining: boolean;
}

/**
 * The other medications a row shares its wall-clock time with *after* saving.
 *
 * A slot's time belongs to the slot, not to one medication, so the editor has to
 * disclose two different things: that retiming a shared slot moves everyone
 * else's dose too, and that retiming onto an occupied time starts sharing with
 * medications the user was not sharing with before. Both are read off the target
 * time, not the row's original slot.
 */
export function coScheduledAtTime(
  slots: Slot[],
  row: { slotId?: string; time: string },
  medId: string,
): SharedTime {
  const own = row.slotId == null ? undefined : slots.find((s) => live(s) && s.id === row.slotId);
  const stayingPut = own != null && own.time === row.time;
  const slot = stayingPut ? own : occupantAt(slots, row.time, medId, row.slotId);
  if (!slot) return { medIds: [], joining: false };
  return {
    medIds: slot.items.filter((i) => i.medId !== medId).map((i) => i.medId),
    joining: !stayingPut,
  };
}

export function isValidTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

/** Times entered twice for the same medication — the one ambiguity the plan cannot resolve. */
export function duplicateTimes(rows: MedTimeRow[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.time)) dupes.add(r.time);
    seen.add(r.time);
  }
  return [...dupes];
}
