// Doctor's appointments & tests — pure domain core (Stage 20).
//
// An appointment is a scheduled (or past) medical appointment/test plus free-text
// notes for what happened. This module owns:
//   - the kind/status vocabularies;
//   - the "upcoming vs past" derivation (from scheduledAt, never stored);
//   - validation of an appointment's shape (title required, enums, finite time);
//   - display-label helpers.
//
// Like `core/guardrails.ts` / `core/events.ts`, the validator returns a list of
// human-readable messages (empty = valid) and never originates a value; the UI
// blocks save on them. No React/store/DOM imports — portable, unit-tested core.

import type { AppointmentKind, AppointmentStatus, Instant } from './types';

export const APPOINTMENT_KINDS: readonly AppointmentKind[] = ['appointment', 'test', 'other'];
export const APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'scheduled',
  'completed',
  'cancelled',
];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Where an appointment falls relative to `now`: `upcoming` when it is at or after
 * now, otherwise `past`. Derived on read — never stored — so it stays correct as
 * time passes without any background recompute.
 */
export function appointmentTiming(scheduledAt: Instant, now: Instant): 'upcoming' | 'past' {
  return scheduledAt >= now ? 'upcoming' : 'past';
}

/**
 * Validate an appointment's shape before write (FR-APPT-5): a non-empty title, a
 * known kind and status, and a finite scheduled instant. Returns a list of
 * messages; empty means valid.
 */
export function validateAppointment(appt: {
  kind: AppointmentKind;
  title: string;
  scheduledAt: Instant;
  status: AppointmentStatus;
}): string[] {
  const errors: string[] = [];
  if (!appt.title.trim()) errors.push('Title is required.');
  if (!APPOINTMENT_KINDS.includes(appt.kind)) errors.push('Pick a kind.');
  if (!APPOINTMENT_STATUSES.includes(appt.status)) errors.push('Pick a status.');
  if (!isFiniteNumber(appt.scheduledAt)) errors.push('Pick a date and time.');
  return errors;
}

// ---- Display helpers ---------------------------------------------------------

const KIND_LABELS: Record<AppointmentKind, string> = {
  appointment: 'Appointment',
  test: 'Test',
  other: 'Other',
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function appointmentKindLabel(kind: AppointmentKind): string {
  return KIND_LABELS[kind] ?? kind;
}

export function appointmentStatusLabel(status: AppointmentStatus): string {
  return STATUS_LABELS[status] ?? status;
}
