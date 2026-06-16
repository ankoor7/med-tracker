import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDER_PREFS,
  INITIAL_MISSED_STATE,
  computeDoseReminders,
  evaluateMissedPattern,
  followUpReminder,
  type ReminderPrefs,
} from './reminders';
import { computeAdherence } from './adherence';
import { resolveWallTimeToInstant } from './time';
import { logEntry, med, slot } from '../test/fixtures';

const ZONE = 'Europe/London';
const DATE = '2026-06-16';
const enabled = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({
  ...DEFAULT_REMINDER_PREFS,
  enabled: true,
  ...over,
});

// 06:00 the morning of DATE, before the 08:00 and 20:00 slots.
const MORNING = resolveWallTimeToInstant(DATE, '06:00', ZONE);
const eightInstant = resolveWallTimeToInstant(DATE, '08:00', ZONE);

const dataset = () => {
  const m = med({ id: 'm1', name: 'Levo', adjustWhenLate: true });
  return {
    meds: [m],
    slots: [
      slot({ id: 's-am', time: '08:00', items: [{ medId: 'm1', dose: 100 }] }),
      slot({ id: 's-pm', time: '20:00', label: 'Evening', items: [{ medId: 'm1', dose: 100 }] }),
    ],
  };
};

describe('computeDoseReminders', () => {
  it('schedules upcoming doses in the active zone (AC1)', () => {
    const { meds, slots } = dataset();
    const out = computeDoseReminders(slots, meds, [], ZONE, MORNING, enabled());
    expect(out.map((r) => r.slotId)).toEqual(['s-am', 's-pm']);
    expect(out[0]?.fireAt).toBe(eightInstant);
    expect(out[0]?.scheduledInstant).toBe(eightInstant);
  });

  it('returns nothing when reminders are disabled', () => {
    const { meds, slots } = dataset();
    expect(computeDoseReminders(slots, meds, [], ZONE, MORNING)).toEqual([]);
  });

  it('applies the lead time and reschedules to the new zone (AC4)', () => {
    const { meds, slots } = dataset();
    const out = computeDoseReminders(slots, meds, [], ZONE, MORNING, enabled({ leadMinutes: 15 }));
    expect(out[0]?.fireAt).toBe(eightInstant - 15 * 60_000);

    // Same data, different active zone → 08:00 resolves to a different instant.
    const ny = computeDoseReminders(slots, meds, [], 'America/New_York', MORNING, enabled());
    const eightNy = resolveWallTimeToInstant(DATE, '08:00', 'America/New_York');
    expect(ny.find((r) => r.slotId === 's-am')?.scheduledInstant).toBe(eightNy);
    expect(eightNy).not.toBe(eightInstant);
  });

  it('skips muted slots and already-taken occurrences', () => {
    const { meds, slots } = dataset();
    const taken = logEntry({
      medId: 'm1',
      slotId: 's-am',
      scheduledInstant: eightInstant,
      zone: ZONE,
      status: 'taken',
    });
    const out = computeDoseReminders(
      slots,
      meds,
      [taken],
      ZONE,
      MORNING,
      enabled({ mutedSlotIds: ['s-pm'] }),
    );
    // s-pm muted, s-am already taken → nothing left.
    expect(out).toEqual([]);
  });

  it('never includes a dose value (AC6)', () => {
    const { meds, slots } = dataset();
    const out = computeDoseReminders(slots, meds, [], ZONE, MORNING, enabled());
    for (const r of out) {
      expect(r.body).not.toContain('100');
      expect(r.body).not.toMatch(/\bmg\b/);
    }
    expect(out[1]?.body).toContain('Evening'); // label is fine, it is not a dose
  });
});

describe('followUpReminder', () => {
  const m = med({
    id: 'm1',
    name: 'Levo',
    guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: 4 },
  });

  it('schedules a follow-up after a late dose at the interval boundary (AC2)', () => {
    const scheduled = eightInstant;
    const actual = scheduled + 60 * 60_000; // an hour late
    const entry = logEntry({
      id: 'l1',
      medId: 'm1',
      slotId: 's-am',
      scheduledInstant: scheduled,
      actualInstant: actual,
    });
    const r = followUpReminder(entry, m, actual, enabled());
    expect(r).not.toBeNull();
    expect(r?.fireAt).toBe(actual + 4 * 60 * 60_000);
    expect(r?.kind).toBe('followup');
    expect(r?.body).not.toMatch(/\bmg\b/);
  });

  it('returns null for an on-time dose, or a med without a minimum interval', () => {
    const onTime = logEntry({
      medId: 'm1',
      scheduledInstant: eightInstant,
      actualInstant: eightInstant,
    });
    expect(followUpReminder(onTime, m, eightInstant, enabled())).toBeNull();

    const flexible = med({
      id: 'm1',
      guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
    });
    const late = logEntry({
      medId: 'm1',
      scheduledInstant: eightInstant,
      actualInstant: eightInstant + 2 * 60 * 60_000,
    });
    expect(followUpReminder(late, flexible, eightInstant, enabled())).toBeNull();
  });

  it('returns null when the follow-up time has already passed', () => {
    const actual = eightInstant;
    const entry = logEntry({
      medId: 'm1',
      scheduledInstant: actual,
      actualInstant: actual,
      adjusted: true,
    });
    const wayLater = actual + 10 * 60 * 60_000;
    expect(followUpReminder(entry, m, wayLater, enabled())).toBeNull();
  });
});

describe('evaluateMissedPattern', () => {
  // Three timing-sensitive doses all missed, threshold 2 → breach.
  function breach() {
    const m = med({ id: 'm1', adjustWhenLate: true });
    const slots = [
      slot({ id: 's1', time: '08:00', items: [{ medId: 'm1', dose: 100 }] }),
      slot({ id: 's2', time: '14:00', items: [{ medId: 'm1', dose: 100 }] }),
      slot({ id: 's3', time: '20:00', items: [{ medId: 'm1', dose: 100 }] }),
    ];
    const now = resolveWallTimeToInstant(DATE, '23:00', ZONE);
    return computeAdherence(slots, [m], [], ZONE, 1, 2, now);
  }

  it('fires exactly once per breach (rising edge) — AC3', () => {
    const adherence = breach();
    expect(adherence.missedPatternWarning).toBe(true);
    const now = Date.now();

    const first = evaluateMissedPattern(adherence, INITIAL_MISSED_STATE, now);
    expect(first.reminder).not.toBeNull();
    expect(first.state.active).toBe(true);

    // Still breaching, but already alerted → no repeat.
    const second = evaluateMissedPattern(adherence, first.state, now);
    expect(second.reminder).toBeNull();
  });

  it('re-arms after recovery and fires again on a new breach', () => {
    const now = Date.now();
    const breached = breach();
    const fired = evaluateMissedPattern(breached, INITIAL_MISSED_STATE, now);

    // Recover: no missed-pattern warning → state clears, no alert.
    const recovered = { ...breached, missed: 0, missedPatternWarning: false };
    const cleared = evaluateMissedPattern(recovered, fired.state, now);
    expect(cleared.reminder).toBeNull();
    expect(cleared.state.active).toBe(false);

    // New breach → fires again.
    const again = evaluateMissedPattern(breached, cleared.state, now);
    expect(again.reminder).not.toBeNull();
  });

  it('missed alert carries no dose value (AC6)', () => {
    const r = evaluateMissedPattern(breach(), INITIAL_MISSED_STATE, Date.now()).reminder;
    expect(r?.body).not.toMatch(/\bmg\b/);
    expect(r?.body).toMatch(/missed/i);
  });
});
