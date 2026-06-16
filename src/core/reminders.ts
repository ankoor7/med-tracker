// Reminder computation — pure. See specs/stage-6-reminders-notifications.md.
//
// All reminder *timing* is derived here from the canonical schedule/log/adherence
// in the active zone; the browser layer (`src/reminders/`) only fires what this
// produces. Two safety rules hold throughout (FR-6.6 / AC6):
//   1. A reminder never contains or implies a dose *value* — only that a dose is
//      due (or that an interval has elapsed, or that doses were missed).
//   2. Timing is always resolved in the active zone, so a zone change simply
//      recomputes to new instants (FR-6.4).

import { computeAdherence, type AdherenceResult } from './adherence';
import { plannedSlotsForDate } from './schedule';
import { addDaysToIsoDate, isoDateInZone } from './time';
import type { DoseLogEntry, IanaZone, Instant, Medication, Slot } from './types';

export type ReminderKind = 'dose' | 'followup' | 'missed';

/** A timing-only notification the browser layer may fire. Carries no dose value. */
export interface ScheduledReminder {
  /** Stable dedupe key so recomputes (every tick / zone change) don't double-fire. */
  id: string;
  kind: ReminderKind;
  fireAt: Instant;
  title: string;
  body: string;
  slotId?: string;
  scheduledInstant?: Instant;
}

/** Device-local reminder preferences (not synced — notifications are per-device). */
export interface ReminderPrefs {
  enabled: boolean;
  /** Fire this many minutes before the scheduled time (0 = at the time). */
  leadMinutes: number;
  followUpEnabled: boolean;
  /** Slots the user has opted out of (per-slot toggle, FR task 6). */
  mutedSlotIds: string[];
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: false,
  leadMinutes: 0,
  followUpEnabled: true,
  mutedSlotIds: [],
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How late (vs scheduled) a dose must be to be treated as "late" for follow-up. */
export const LATE_GRACE_MS = 30 * MINUTE_MS;
/** Default look-ahead window for dose reminders. */
export const DEFAULT_HORIZON_MS = DAY_MS;

/**
 * Upcoming dose reminders within `[now, now + horizonMs]`, one per (slot, day)
 * group that still has an untaken occurrence. Zone-aware (FR-6.1/6.4). Muted
 * slots and disabled reminders yield nothing.
 */
export function computeDoseReminders(
  slots: Slot[],
  medications: Medication[],
  log: DoseLogEntry[],
  zone: IanaZone,
  now: Instant,
  prefs: ReminderPrefs = DEFAULT_REMINDER_PREFS,
  horizonMs: number = DEFAULT_HORIZON_MS,
): ScheduledReminder[] {
  if (!prefs.enabled) return [];
  const muted = new Set(prefs.mutedSlotIds);
  const lead = Math.max(0, prefs.leadMinutes) * MINUTE_MS;
  const reminders: ScheduledReminder[] = [];

  // Cover today plus every day touched by the horizon (resolved in the zone).
  const startDate = isoDateInZone(now, zone);
  const lastDate = isoDateInZone(now + horizonMs, zone);
  for (let date = startDate; ; date = addDaysToIsoDate(date, 1)) {
    const planned = plannedSlotsForDate(date, slots, medications, log, zone, now);
    for (const slot of planned) {
      if (muted.has(slot.slotId)) continue;
      const due = slot.occurrences.filter((o) => o.status === 'upcoming');
      if (due.length === 0) continue;
      const at = slot.scheduledInstant;
      if (at <= now || at > now + horizonMs) continue;
      reminders.push({
        id: `dose:${slot.slotId}:${date}`,
        kind: 'dose',
        fireAt: at - lead,
        slotId: slot.slotId,
        scheduledInstant: at,
        title: 'Medication reminder',
        body: doseBody(due.length, slot.time, slot.label),
      });
    }
    if (date === lastDate) break;
  }

  reminders.sort((a, b) => a.fireAt - b.fireAt);
  return reminders;
}

function doseBody(count: number, time: string, label?: string): string {
  const what = count === 1 ? 'A dose is' : `${count} doses are`;
  const where = label ? ` (${label})` : '';
  // Deliberately no amount/unit — only that something is due, and when.
  return `${what} due${where} at ${time}.`;
}

/**
 * A follow-up reminder for a late/adjusted dose, where the medication defines a
 * minimum interval (FR-6.2). Timing only: it tells the user the safe interval has
 * elapsed, never a dose to take. Returns null when not relevant or already past.
 */
export function followUpReminder(
  entry: DoseLogEntry,
  med: Medication,
  now: Instant,
  prefs: ReminderPrefs = DEFAULT_REMINDER_PREFS,
): ScheduledReminder | null {
  if (!prefs.enabled || !prefs.followUpEnabled) return null;
  const minInterval = med.guardrails.minIntervalHours;
  if (minInterval == null) return null;
  const late = entry.actualInstant - entry.scheduledInstant > LATE_GRACE_MS;
  if (!late && !entry.adjusted) return null;
  const fireAt = entry.actualInstant + minInterval * HOUR_MS;
  if (fireAt <= now) return null;
  return {
    id: `followup:${entry.id}`,
    kind: 'followup',
    fireAt,
    slotId: entry.slotId,
    title: 'Follow-up reminder',
    body: `The minimum interval since your last ${med.name} dose has elapsed.`,
  };
}

/** Persisted edge-detector state so a missed-pattern alert fires once per breach. */
export interface MissedPatternState {
  active: boolean;
}

export const INITIAL_MISSED_STATE: MissedPatternState = { active: false };

/**
 * Evaluate the missed-pattern alert with rising-edge debounce (FR-6.3 / AC3):
 * fire exactly once when adherence first crosses the threshold, and not again
 * until it recovers below the threshold and breaches afresh.
 */
export function evaluateMissedPattern(
  adherence: AdherenceResult,
  prev: MissedPatternState,
  now: Instant,
): { reminder: ScheduledReminder | null; state: MissedPatternState } {
  const breaching = adherence.missedPatternWarning;
  const state: MissedPatternState = { active: breaching };
  if (!breaching || prev.active) return { reminder: null, state };
  return {
    reminder: {
      id: `missed:${adherence.to}`,
      kind: 'missed',
      fireAt: now,
      title: 'Missed doses',
      body: `You have missed ${adherence.missed} timing-sensitive dose${
        adherence.missed === 1 ? '' : 's'
      } in the last ${adherence.windowDays} days.`,
    },
    state,
  };
}

/** Convenience: evaluate the missed-pattern alert straight from the dataset. */
export function missedPatternFromDataset(
  slots: Slot[],
  medications: Medication[],
  log: DoseLogEntry[],
  zone: IanaZone,
  windowDays: number,
  missedThreshold: number,
  now: Instant,
  prev: MissedPatternState,
): { reminder: ScheduledReminder | null; state: MissedPatternState; adherence: AdherenceResult } {
  const adherence = computeAdherence(
    slots,
    medications,
    log,
    zone,
    windowDays,
    missedThreshold,
    now,
  );
  return { ...evaluateMissedPattern(adherence, prev, now), adherence };
}
