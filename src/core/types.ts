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

export interface Settings {
  zone: IanaZone;
  adherenceWindowDays: number;
  missedDayThreshold: number;
  updatedAt: Instant;
  version?: number;
}

// Aggregate of all syncable records — used by the store and (Stage 2) repository.
export interface Dataset {
  medications: Medication[];
  slots: Slot[];
  doseLog: DoseLogEntry[];
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
  logEntryId?: string; // set when taken/skipped
}

// Today's view: occurrences grouped by slot, sorted by time.
export interface PlannedSlot {
  slotId: string;
  time: WallTime;
  label?: string;
  scheduledInstant: Instant;
  occurrences: PlannedOccurrence[];
}
