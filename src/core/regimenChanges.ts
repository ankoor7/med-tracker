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
  Slot,
} from './types';

/** Display a dose with its unit, e.g. `formatDose(150, 'mg') === '150mg'`. */
export function formatDose(dose: number, unit: string): string {
  return `${dose}${unit}`;
}

function fieldChange(field: string, from: string | null, to: string | null): RegimenFieldChange {
  return { field, from, to };
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
  field: string;
  value: (m: Medication) => string | number | boolean | null | undefined;
  display: (m: Medication) => string | null;
}

const MED_FIELDS: MedFieldSpec[] = [
  { field: 'Name', value: (m) => m.name, display: (m) => m.name },
  { field: 'Unit', value: (m) => m.unit, display: (m) => m.unit },
  {
    field: 'Half-life (h)',
    value: (m) => m.halfLifeHours,
    display: (m) => String(m.halfLifeHours),
  },
  { field: 'Timing', value: (m) => m.adjustWhenLate, display: timingLabel },
  { field: 'Notes', value: (m) => m.notes ?? '', display: (m) => m.notes ?? null },
  {
    field: 'Max single dose',
    value: (m) => m.guardrails.maxSingleDose,
    display: (m) => optionalNumber(m.guardrails.maxSingleDose),
  },
  {
    field: 'Max daily dose',
    value: (m) => m.guardrails.maxDailyDose,
    display: (m) => optionalNumber(m.guardrails.maxDailyDose),
  },
  {
    field: 'Min interval (h)',
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
      out.push(fieldChange(spec.field, spec.display(prev), spec.display(next)));
    }
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
  const out: RegimenFieldChange[] = [];
  if (prev.time !== next.time) out.push(fieldChange('Time', prev.time, next.time));
  if ((prev.label ?? '') !== (next.label ?? '')) {
    out.push(fieldChange('Label', prev.label ?? null, next.label ?? null));
  }

  const prevItems = new Map(prev.items.map((i) => [i.medId, i.dose]));
  const nextItems = new Map(next.items.map((i) => [i.medId, i.dose]));
  const medIds = new Set([...prevItems.keys(), ...nextItems.keys()]);
  const label = (medId: string) => {
    const med = medsById.get(medId);
    return `${med?.name ?? medId} dose`;
  };
  const dose = (medId: string, amount: number) =>
    formatDose(amount, medsById.get(medId)?.unit ?? '');

  // Sort for deterministic output (Map iteration order follows insertion).
  for (const medId of [...medIds].sort()) {
    const before = prevItems.get(medId);
    const after = nextItems.get(medId);
    if (before === after) continue;
    out.push(
      fieldChange(
        label(medId),
        before == null ? null : dose(medId, before),
        after == null ? null : dose(medId, after),
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
