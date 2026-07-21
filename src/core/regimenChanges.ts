// Regimen change derivation — pure. See specs/stage-16-regimen-change-markers.md.
//
// Diffs the previous vs next medication/slot to produce display-ready
// `RegimenFieldChange`s, builds a `RegimenChange` record from them, and groups
// changes by local calendar day for the marker layer. No store/UI/React imports.

import { newId } from './ids';
import { isoDateInZone } from './time';
import type {
  IanaZone,
  ISODate,
  Instant,
  Medication,
  RegimenChange,
  RegimenChangeKind,
  RegimenFieldChange,
  RegimenFieldKey,
  RegimenFieldValue,
  Slot,
} from './types';

/** Display a dose with its unit, e.g. `formatDose(150, 'mg') === '150mg'`. */
export function formatDose(dose: number, unit: string): string {
  return `${dose}${unit}`;
}

/**
 * A field change that carries the Stage 18 machine layer. Every change this
 * module derives is structured; only records persisted before Stage 18 are not.
 */
export interface StructuredRegimenFieldChange extends RegimenFieldChange {
  key: RegimenFieldKey;
  fromValue: RegimenFieldValue;
  toValue: RegimenFieldValue;
}

/**
 * Narrow a field change to its structured form. Explicitly checks for the
 * machine layer rather than inferring it: a pre-Stage-18 record has display
 * strings only, and no structure may be invented by parsing them.
 */
export function isStructuredFieldChange(
  change: RegimenFieldChange,
): change is StructuredRegimenFieldChange {
  return change.key !== undefined && 'fromValue' in change && 'toValue' in change;
}

/** The machine layer of one field change: identity + typed before/after values. */
interface FieldIdentity {
  key: RegimenFieldKey;
  fromValue: RegimenFieldValue;
  toValue: RegimenFieldValue;
  medId?: string;
  slotId?: string;
}

// Both layers are always written together: the display strings the UI renders
// and the structured identity/values a reader (or a future migration) can trust.
function fieldChange(
  field: string,
  from: string | null,
  to: string | null,
  identity: FieldIdentity,
): RegimenFieldChange {
  const { key, fromValue, toValue, medId, slotId } = identity;
  return {
    field,
    from,
    to,
    key,
    ...(medId ? { medId } : {}),
    ...(slotId ? { slotId } : {}),
    fromValue,
    toValue,
  };
}

/** Normalise a comparable medication-field value into a storable typed value. */
function fieldValue(value: string | number | boolean | null | undefined): RegimenFieldValue {
  return value === undefined ? null : value;
}

function optionalNumber(value: number | null | undefined): string | null {
  return value == null ? null : String(value);
}

function timingLabel(m: Medication): string {
  return m.adjustWhenLate ? 'timing-sensitive' : 'flexible';
}

// One comparable field of a medication's prescription: its label and how to read
// the comparable value and its display string. Data-driven so `diffMedication`
// stays a single loop rather than a long run of `if`s.
interface MedFieldSpec {
  field: string; // human label — a copy edit, not part of the stored schema
  key: RegimenFieldKey; // stable machine identity — changing it is a migration
  value: (m: Medication) => string | number | boolean | null | undefined;
  display: (m: Medication) => string | null;
}

const MED_FIELDS: MedFieldSpec[] = [
  { field: 'Name', key: 'med.name', value: (m) => m.name, display: (m) => m.name },
  { field: 'Unit', key: 'med.unit', value: (m) => m.unit, display: (m) => m.unit },
  {
    field: 'Half-life (h)',
    key: 'med.halfLifeHours',
    value: (m) => m.halfLifeHours,
    display: (m) => String(m.halfLifeHours),
  },
  {
    field: 'Timing',
    key: 'med.adjustWhenLate',
    value: (m) => m.adjustWhenLate,
    display: timingLabel,
  },
  {
    field: 'Notes',
    key: 'med.notes',
    value: (m) => m.notes ?? '',
    display: (m) => m.notes ?? null,
  },
  {
    field: 'Max single dose',
    key: 'med.guardrails.maxSingleDose',
    value: (m) => m.guardrails.maxSingleDose,
    display: (m) => optionalNumber(m.guardrails.maxSingleDose),
  },
  {
    field: 'Max daily dose',
    key: 'med.guardrails.maxDailyDose',
    value: (m) => m.guardrails.maxDailyDose,
    display: (m) => optionalNumber(m.guardrails.maxDailyDose),
  },
  {
    field: 'Min interval (h)',
    key: 'med.guardrails.minIntervalHours',
    value: (m) => m.guardrails.minIntervalHours,
    display: (m) => optionalNumber(m.guardrails.minIntervalHours),
  },
];

/**
 * Field-level diff of a medication's prescription (everything except the
 * per-slot dose, which lives on `Slot`). Returns only the fields that actually
 * changed; an empty array means "no meaningful change".
 */
export function diffMedication(prev: Medication, next: Medication): RegimenFieldChange[] {
  const out: RegimenFieldChange[] = [];
  for (const spec of MED_FIELDS) {
    if (spec.value(prev) !== spec.value(next)) {
      out.push(
        fieldChange(spec.field, spec.display(prev), spec.display(next), {
          key: spec.key,
          medId: next.id,
          fromValue: fieldValue(spec.value(prev)),
          toValue: fieldValue(spec.value(next)),
        }),
      );
    }
  }
  return out;
}

/** The slot's own attributes (time, label) — everything except its doses. */
function diffSlotAttributes(prev: Slot, next: Slot): RegimenFieldChange[] {
  const out: RegimenFieldChange[] = [];
  const slotId = next.id;
  if (prev.time !== next.time) {
    out.push(
      fieldChange('Time', prev.time, next.time, {
        key: 'slot.time',
        slotId,
        fromValue: prev.time,
        toValue: next.time,
      }),
    );
  }
  if ((prev.label ?? '') !== (next.label ?? '')) {
    out.push(
      fieldChange('Label', prev.label ?? null, next.label ?? null, {
        key: 'slot.label',
        slotId,
        fromValue: prev.label ?? null,
        toValue: next.label ?? null,
      }),
    );
  }
  return out;
}

/**
 * The per-medication amounts in the group: added, removed, and changed items.
 * A `dose` of `undefined` on either side means the medication was not in the
 * slot then — recorded as a null value, not a zero.
 */
function diffSlotDoses(
  prev: Slot,
  next: Slot,
  medsById: Map<string, Medication>,
): RegimenFieldChange[] {
  const prevItems = new Map(prev.items.map((i) => [i.medId, i.dose]));
  const nextItems = new Map(next.items.map((i) => [i.medId, i.dose]));
  const medIds = new Set([...prevItems.keys(), ...nextItems.keys()]);
  const label = (medId: string) => `${medsById.get(medId)?.name ?? medId} dose`;
  const display = (medId: string, amount: number | undefined) =>
    amount == null ? null : formatDose(amount, medsById.get(medId)?.unit ?? '');

  const out: RegimenFieldChange[] = [];
  // Sort for deterministic output (Map iteration order follows insertion).
  for (const medId of [...medIds].sort()) {
    const before = prevItems.get(medId);
    const after = nextItems.get(medId);
    if (before === after) continue;
    // The label is a display name; `medId` is what identifies the medication.
    // Without it the change breaks on duplicate names, a later rename, or a
    // medication deleted before the change is read back.
    out.push(
      fieldChange(label(medId), display(medId, before), display(medId, after), {
        key: 'slot.dose',
        medId,
        slotId: next.id,
        fromValue: before ?? null,
        toValue: after ?? null,
      }),
    );
  }
  return out;
}

/**
 * Field-level diff of a schedule slot: its time, label, and the per-medication
 * amounts in the group (added / removed / changed items). `medsById` resolves a
 * medication's display name + unit for the field labels and dose formatting.
 */
export function diffSlot(
  prev: Slot,
  next: Slot,
  medsById: Map<string, Medication>,
): RegimenFieldChange[] {
  return [...diffSlotAttributes(prev, next), ...diffSlotDoses(prev, next, medsById)];
}

/**
 * Field changes describing a newly added medication: every non-empty
 * prescription field as a `null → value` addition. Used when a medication is
 * introduced (there is no prior entity to diff against).
 */
export function describeMedicationAdded(med: Medication): RegimenFieldChange[] {
  return MED_FIELDS.map((spec) =>
    fieldChange(spec.field, null, spec.display(med), {
      key: spec.key,
      medId: med.id,
      fromValue: null,
      toValue: fieldValue(spec.value(med)),
    }),
  ).filter((c) => c.to != null);
}

/**
 * A single field change marking a medication as retired (active → false).
 * `med` attributes the change to a specific medication; it is optional only so
 * callers without the entity to hand still produce a valid display row.
 */
export function describeMedicationRetired(med?: Medication): RegimenFieldChange[] {
  return [
    fieldChange('Status', 'Active', 'Retired', {
      key: 'med.active',
      ...(med ? { medId: med.id } : {}),
      fromValue: true,
      toValue: false,
    }),
  ];
}

/**
 * A medication resumed after retirement (active false → true). Distinct from
 * `medication-added`: the prescription already existed and nothing but its
 * status changed, so recording the whole prescription again would overstate it.
 */
export function describeMedicationReactivated(med: Medication): RegimenFieldChange[] {
  return [
    fieldChange('Status', 'Retired', 'Active', {
      key: 'med.active',
      medId: med.id,
      fromValue: false,
      toValue: true,
    }),
  ];
}

/** One slot a hard-deleted medication was removed from, as it stood *before*. */
export interface SlotCascadeRemoval {
  slot: Slot; // the pre-edit slot (its time/label name the affected occurrence)
  dose: number; // the per-slot amount that disappeared
  slotRemoved: boolean; // the slot held only this medication and was tombstoned
}

/**
 * The slot cascade of a *hard* medication delete. Deleting a medication strips
 * it from every slot and tombstones any slot left empty; without this those
 * doses would vanish from the record with nothing but `Status Active → Retired`
 * to show for them. Folded into the single retirement marker (rather than one
 * marker per slot) — each row carries its own `slotId`, so one record can span
 * slots without ambiguity.
 *
 * The *soft* path (`active: false`) leaves slot items intact and has no cascade.
 */
export function describeMedicationSlotCascade(
  med: Medication,
  removals: SlotCascadeRemoval[],
): RegimenFieldChange[] {
  const out: RegimenFieldChange[] = [];
  const ordered = [...removals].sort((a, b) => {
    if (a.slot.time !== b.slot.time) return a.slot.time < b.slot.time ? -1 : 1;
    return a.slot.id < b.slot.id ? -1 : a.slot.id > b.slot.id ? 1 : 0;
  });
  for (const { slot, dose, slotRemoved } of ordered) {
    const subject = slotSubject(slot);
    out.push(
      fieldChange(`${subject}: ${med.name} dose`, formatDose(dose, med.unit), null, {
        key: 'slot.dose',
        medId: med.id,
        slotId: slot.id,
        fromValue: dose,
        toValue: null,
      }),
    );
    if (slotRemoved) {
      out.push(
        fieldChange(`${subject}: slot`, subject, null, {
          key: 'slot.removed',
          slotId: slot.id,
          fromValue: slot.time,
          toValue: null,
        }),
      );
    }
  }
  return out;
}

/** Human subject for a slot's marker summary, e.g. `"20:00 Evening"`. */
export function slotSubject(slot: Slot): string {
  return slot.label ? `${slot.time} ${slot.label}` : slot.time;
}

/**
 * Field changes describing a slot being added (`mode: 'added'`, values appear as
 * `null → value`) or removed (`mode: 'removed'`, `value → null`): its time, label
 * and each per-medication dose. `medsById` resolves names/units for formatting.
 */
export function describeSlot(
  slot: Slot,
  medsById: Map<string, Medication>,
  mode: 'added' | 'removed',
): RegimenFieldChange[] {
  const sides = (value: string | null): [string | null, string | null] =>
    mode === 'added' ? [null, value] : [value, null];
  const values = (value: RegimenFieldValue): [RegimenFieldValue, RegimenFieldValue] =>
    mode === 'added' ? [null, value] : [value, null];
  const identity = (
    key: RegimenFieldKey,
    value: RegimenFieldValue,
    medId?: string,
  ): FieldIdentity => {
    const [fromValue, toValue] = values(value);
    return { key, slotId: slot.id, ...(medId ? { medId } : {}), fromValue, toValue };
  };

  const out: RegimenFieldChange[] = [];
  out.push(fieldChange('Time', ...sides(slot.time), identity('slot.time', slot.time)));
  if (slot.label) {
    out.push(fieldChange('Label', ...sides(slot.label), identity('slot.label', slot.label)));
  }
  for (const item of [...slot.items].sort((a, b) => (a.medId < b.medId ? -1 : 1))) {
    const med = medsById.get(item.medId);
    out.push(
      fieldChange(
        `${med?.name ?? item.medId} dose`,
        ...sides(formatDose(item.dose, med?.unit ?? '')),
        identity('slot.dose', item.dose, item.medId),
      ),
    );
  }
  return out;
}

function oneLineChange(c: RegimenFieldChange): string {
  return `${c.field} ${c.from ?? '—'} → ${c.to ?? '—'}`;
}

function composeSummary(
  kind: RegimenChangeKind,
  subject: string,
  changes: RegimenFieldChange[],
): string {
  switch (kind) {
    case 'medication-added':
      return `Added ${subject}`;
    case 'medication-reactivated':
      return `Resumed ${subject}`;
    case 'medication-retired':
      return `Retired ${subject}`;
    case 'slot-added':
      return `Added ${subject}`;
    case 'slot-removed':
      return `Removed ${subject}`;
    case 'medication-updated':
    case 'slot-updated':
      if (changes.length === 1) return `${subject}: ${oneLineChange(changes[0]!)}`;
      return `${subject}: ${changes.length} changes`;
  }
}

export interface BuildRegimenChangeInput {
  kind: RegimenChangeKind;
  subject: string; // medication name or slot label, for the summary
  medId?: string;
  slotId?: string;
  changes: RegimenFieldChange[];
  now: Instant;
  zone: IanaZone;
}

/**
 * Assemble a `RegimenChange` record from a derived diff. `changedAt` and
 * `updatedAt` are equal at creation; the summary is composed from the kind +
 * subject + changes. Pure — id is the only nondeterminism (via `newId`).
 */
export function buildRegimenChange(input: BuildRegimenChangeInput): RegimenChange {
  const { kind, subject, medId, slotId, changes, now, zone } = input;
  return {
    id: newId(),
    changedAt: now,
    zone,
    kind,
    ...(medId ? { medId } : {}),
    ...(slotId ? { slotId } : {}),
    summary: composeSummary(kind, subject, changes),
    changes,
    updatedAt: now,
  };
}

export interface RegimenChangeGroup {
  date: ISODate; // local calendar day (in `zone`)
  changes: RegimenChange[]; // sorted by `changedAt` ascending
}

/**
 * Group non-deleted changes by their local calendar day (in `zone`), for the
 * same-day-grouped marker layer. Groups are sorted by date ascending; each
 * group's changes are sorted by `changedAt` ascending.
 */
export function groupChangesByDay(changes: RegimenChange[], zone: IanaZone): RegimenChangeGroup[] {
  const byDay = new Map<ISODate, RegimenChange[]>();
  for (const change of changes) {
    if (change.deleted) continue;
    const date = isoDateInZone(change.changedAt, zone);
    const bucket = byDay.get(date);
    if (bucket) bucket.push(change);
    else byDay.set(date, [change]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, group]) => ({
      date,
      changes: group.sort((a, b) => a.changedAt - b.changedAt),
    }));
}
