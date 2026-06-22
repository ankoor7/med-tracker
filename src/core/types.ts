// Canonical data model — see specs/02-architecture.md §5.
// Pure types only. No runtime, no React, no I/O.

export type ISODate = string; // "YYYY-MM-DD"
export type WallTime = string; // "HH:MM" 24h
export type Instant = number; // epoch ms (UTC)
export type IanaZone = string; // e.g. "Europe/London"

export interface Guardrails {
  maxSingleDose: number | null;
  maxDailyDose: number | null;
  minIntervalHours: number | null;
}

export interface Medication {
  id: string;
  name: string;
  color: string; // hex
  unit: string; // e.g. "mg"
  halfLifeHours: number; // stored for the user's equations
  adjustWhenLate: boolean; // timing-sensitive vs flexible
  active: boolean;
  notes?: string;
  guardrails: Guardrails;
  updatedAt: Instant;
  version?: number; // sync metadata (Stage 2+)
  deleted?: boolean;
}

export interface ScheduleItem {
  medId: string;
  dose: number;
}

export interface Slot {
  id: string;
  time: WallTime; // wall-clock, resolved in current zone
  label?: string;
  items: ScheduleItem[]; // the group; >= 1
  updatedAt: Instant;
  version?: number;
  deleted?: boolean;
}

export type DoseStatus = 'taken' | 'skipped';

export interface DoseLogEntry {
  id: string;
  slotId: string;
  medId: string;
  scheduledInstant: Instant;
  actualInstant: Instant;
  dose: number; // actual amount taken (may be adjusted)
  unit: string;
  zone: IanaZone; // zone in effect when taken
  status: DoseStatus;
  adjusted: boolean; // dose !== scheduled dose
  warnings: string[]; // guardrail messages at log time
  updatedAt: Instant;
  version?: number;
  deleted?: boolean;
}

// A one-time override of the dose for a single future occurrence (Stage 12).
// The recurring Slot keeps its normal dose; this changes only the occurrence
// keyed by (slotId, medId, localDate). Consumed (tombstoned) once that
// occurrence is logged.
export interface DoseOverride {
  id: string;
  slotId: string;
  medId: string;
  scheduledInstant: Instant; // the occurrence being overridden
  zone: IanaZone; // zone in effect when set (stable occurrence keying)
  dose: number; // the one-time planned amount
  note?: string;
  updatedAt: Instant;
  version?: number;
  deleted?: boolean;
}

// --- Regimen change markers (Stage 16) ---------------------------------------
// A dated record of a prescription or schedule edit, derived by diffing the
// previous vs next entity inside the store action that performs the edit. The
// app never originates a change — it records the edits the user makes. Surfaced
// as same-day-grouped, tappable markers on the timeline charts.

export type RegimenChangeKind =
  | 'medication-added'
  | 'medication-updated' // name, unit, half-life, timing-sensitivity, guardrails, notes
  | 'medication-retired' // active → false (or deleted)
  | 'slot-added'
  | 'slot-updated' // time, label, or a per-med amount in the slot
  | 'slot-removed';

// One concrete field that changed, in display-ready form. `from`/`to` are
// pre-formatted strings (e.g. "100mg", "08:00") so rendering needs no schema;
// null means the value was newly set (`from`) or cleared/removed (`to`).
export interface RegimenFieldChange {
  field: string; // e.g. "Morning dose", "Name", "Max single dose", "Time"
  from: string | null;
  to: string | null;
}

export interface RegimenChange {
  id: string;
  changedAt: Instant; // when the edit happened (UTC ms) — places the marker
  zone: IanaZone; // zone in effect when changed (stable date placement)
  kind: RegimenChangeKind;
  medId?: string; // affected medication, when applicable
  slotId?: string; // affected slot, when applicable
  summary: string; // one-line human summary
  changes: RegimenFieldChange[]; // the field-level diff (>= 1)
  note?: string; // optional free-text the user can add
  updatedAt: Instant; // sync metadata (equal to changedAt at creation)
  version?: number;
  deleted?: boolean;
}

export interface Settings {
  zone: IanaZone;
  adherenceWindowDays: number;
  missedDayThreshold: number;
  // When on (the default), a past scheduled dose with no log entry is assumed to
  // have been taken on time. The user records only exceptions — a late or missed
  // dose — by logging/editing that occurrence. Off restores the explicit model
  // where a past, untaken dose is "missed"/"due". Optional for back-compat with
  // datasets written before this field existed; read it as `?? true`.
  assumeTakenOnTime?: boolean;
  updatedAt: Instant;
  version?: number;
}

// --- Health-condition event tracking (Stage 13) -------------------------------
// User-definable events (e.g. seizures): a type carries a schema of custom
// properties; an instance records that an event of that type happened at an
// `Instant`, with values filled in for the type's properties. The app never
// originates an event — it records and validates user-entered occurrences.

export type EventPropertyType = 'number' | 'text' | 'scale' | 'duration';

// One custom property in an event type's schema. `scale` uses min/max as an
// inclusive integer range (defaults 1..5); `duration` values are seconds.
export interface EventPropertyDef {
  id: string; // stable; instance values are keyed by it
  name: string; // e.g. "Severity"
  type: EventPropertyType;
  required?: boolean;
  min?: number; // scale lower bound (default 1)
  max?: number; // scale upper bound (default 5)
  unit?: string; // optional display hint for `number`
}

export interface EventType {
  id: string;
  name: string; // e.g. "Seizure"
  color: string; // hex
  properties: EventPropertyDef[];
  notes?: string;
  // Event types are never deleted (their instances are kept as history); they are
  // archived instead — hidden from the active picker but still resolvable and
  // reversible via unarchive.
  archived?: boolean;
  updatedAt: Instant;
  version?: number;
  deleted?: boolean;
}

// A filled-in property value: a number (number/scale/duration) or a string (text).
export type EventPropertyValue = number | string;

export interface EventInstance {
  id: string;
  typeId: string; // references EventType.id
  occurredAt: Instant; // when the event happened (UTC ms)
  zone: IanaZone; // zone in effect when logged (stable display)
  values: Record<string, EventPropertyValue>; // keyed by EventPropertyDef.id
  note?: string;
  updatedAt: Instant;
  version?: number;
  deleted?: boolean;
}

// --- Doctor's appointments & tests (Stage 20) --------------------------------
// A scheduled (or past) medical appointment or test, with free-text notes for
// what happened. Unlike an EventInstance (a point-in-time occurrence that already
// happened), an appointment is scheduled future→past and carries a status
// lifecycle and outcome notes. "Upcoming vs past" is derived from `scheduledAt`,
// never stored. The app never originates an appointment — it records the user's.

export type AppointmentKind = 'appointment' | 'test' | 'other';
export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

export interface Appointment {
  id: string;
  kind: AppointmentKind;
  title: string; // e.g. "Neurology review", "Blood test (LFTs)"
  scheduledAt: Instant; // when it is / was (UTC ms) — drives upcoming vs past
  zone: IanaZone; // zone in effect when set (stable display)
  status: AppointmentStatus;
  provider?: string; // clinician / clinic / department
  location?: string;
  notes?: string; // free text: what happened / things to remember
  updatedAt: Instant;
  version?: number;
  deleted?: boolean;
}

// Aggregate of all syncable records — used by the store and (Stage 2) repository.
export interface Dataset {
  medications: Medication[];
  slots: Slot[];
  doseLog: DoseLogEntry[];
  doseOverrides: DoseOverride[];
  eventTypes: EventType[];
  eventInstances: EventInstance[];
  regimenChanges: RegimenChange[];
  appointments: Appointment[];
  settings: Settings;
}

// A single occurrence of one scheduled medication on a given day.
// Produced by schedule enumeration; consumed by the Today screen.
export type OccurrenceStatus = 'upcoming' | 'taken' | 'due' | 'missed';

export interface PlannedOccurrence {
  slotId: string;
  medId: string;
  scheduledInstant: Instant;
  time: WallTime;
  label?: string;
  dose: number;
  status: OccurrenceStatus;
  // True when `status` is 'taken' only because the assume-taken-on-time policy
  // filled it in (no real log entry). Lets the UI show a softer badge and keep an
  // edit affordance so the user can still mark the dose late or missed.
  assumed?: boolean;
  logEntryId?: string; // set when taken/skipped
  overridden?: boolean; // dose came from a one-time DoseOverride (Stage 12)
  overrideId?: string;
}

// Today's view: occurrences grouped by slot, sorted by time.
export interface PlannedSlot {
  slotId: string;
  time: WallTime;
  label?: string;
  scheduledInstant: Instant;
  occurrences: PlannedOccurrence[];
}
