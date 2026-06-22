import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_KINDS,
  APPOINTMENT_STATUSES,
  appointmentKindLabel,
  appointmentStatusLabel,
  appointmentTiming,
  validateAppointment,
} from './appointments';
import type { AppointmentKind, AppointmentStatus } from './types';

const valid = {
  kind: 'appointment' as AppointmentKind,
  title: 'Neurology review',
  scheduledAt: 1_700_000_000_000,
  status: 'scheduled' as AppointmentStatus,
};

describe('appointmentTiming', () => {
  const now = 1_000;
  it('is upcoming when at or after now', () => {
    expect(appointmentTiming(now, now)).toBe('upcoming');
    expect(appointmentTiming(now + 1, now)).toBe('upcoming');
  });
  it('is past when before now', () => {
    expect(appointmentTiming(now - 1, now)).toBe('past');
  });
});

describe('validateAppointment', () => {
  it('accepts a well-formed appointment', () => {
    expect(validateAppointment(valid)).toEqual([]);
  });

  it('requires a non-empty title', () => {
    expect(validateAppointment({ ...valid, title: '   ' })).toContain('Title is required.');
  });

  it('rejects an unknown kind', () => {
    expect(validateAppointment({ ...valid, kind: 'bogus' as AppointmentKind })).toContain(
      'Pick a kind.',
    );
  });

  it('rejects an unknown status', () => {
    expect(validateAppointment({ ...valid, status: 'bogus' as AppointmentStatus })).toContain(
      'Pick a status.',
    );
  });

  it('requires a finite scheduledAt', () => {
    expect(validateAppointment({ ...valid, scheduledAt: NaN })).toContain('Pick a date and time.');
  });
});

describe('labels', () => {
  it('labels every kind and status', () => {
    for (const k of APPOINTMENT_KINDS) expect(appointmentKindLabel(k)).toMatch(/\w/);
    for (const s of APPOINTMENT_STATUSES) expect(appointmentStatusLabel(s)).toMatch(/\w/);
  });
});
