// Device-local reminder preferences + runtime state, persisted in the
// repository `meta` table (Stage 6). These are intentionally NOT synced: a
// notification permission and platform support are per-device, and muting a slot
// on one phone should not silence it on another.

import { DEFAULT_REMINDER_PREFS, type ReminderPrefs } from '../core/reminders';
import { getRepository } from '../store/repository';

const PREFS_KEY = 'reminderPrefs';
const STATE_KEY = 'reminderState';
/** Cap on remembered fired ids so the meta row stays bounded. */
const MAX_FIRED_IDS = 200;

/** Cross-session bookkeeping for dedupe, catch-up, and missed-pattern debounce. */
export interface ReminderRuntimeState {
  /** Reminder ids already fired/surfaced, so we never repeat one. */
  firedIds: string[];
  /** Rising-edge state for the missed-pattern alert. */
  missedActive: boolean;
  /** Last time the app was open; reminders due while closed become catch-up. */
  lastOpenAt: number;
}

export const INITIAL_RUNTIME_STATE: ReminderRuntimeState = {
  firedIds: [],
  missedActive: false,
  lastOpenAt: 0,
};

export async function loadPrefs(): Promise<ReminderPrefs> {
  const raw = await getRepository().getMeta(PREFS_KEY);
  if (!raw) return DEFAULT_REMINDER_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<ReminderPrefs>;
    return {
      ...DEFAULT_REMINDER_PREFS,
      ...parsed,
      mutedSlotIds: Array.isArray(parsed.mutedSlotIds) ? parsed.mutedSlotIds : [],
    };
  } catch {
    return DEFAULT_REMINDER_PREFS;
  }
}

export async function savePrefs(prefs: ReminderPrefs): Promise<void> {
  await getRepository().setMeta(PREFS_KEY, JSON.stringify(prefs));
}

export async function loadRuntimeState(): Promise<ReminderRuntimeState> {
  const raw = await getRepository().getMeta(STATE_KEY);
  if (!raw) return INITIAL_RUNTIME_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<ReminderRuntimeState>;
    return {
      firedIds: Array.isArray(parsed.firedIds) ? parsed.firedIds.slice(-MAX_FIRED_IDS) : [],
      missedActive: !!parsed.missedActive,
      lastOpenAt: typeof parsed.lastOpenAt === 'number' ? parsed.lastOpenAt : 0,
    };
  } catch {
    return INITIAL_RUNTIME_STATE;
  }
}

export async function saveRuntimeState(state: ReminderRuntimeState): Promise<void> {
  const bounded: ReminderRuntimeState = {
    ...state,
    firedIds: state.firedIds.slice(-MAX_FIRED_IDS),
  };
  await getRepository().setMeta(STATE_KEY, JSON.stringify(bounded));
}
