// Reminder engine (Stage 6). Wires the pure timing logic in `core/reminders.ts`
// to the browser: schedules notifications while the app is open, catches up on
// reminders that came due while it was closed, and re-evaluates on every data or
// zone change (FR-6.4 reschedule is automatic — the effect re-runs).
//
// Honest degradation (FR-6.5 / AC5): the web platform cannot reliably wake a
// closed PWA, so anything that came due while closed is surfaced as an in-app
// catch-up list rather than a burst of OS notifications on reopen.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeDoseReminders,
  evaluateMissedPattern,
  followUpReminder,
  type ReminderPrefs,
  type ScheduledReminder,
} from '../core/reminders';
import { computeAdherence } from '../core/adherence';
import { useStore } from '../store/store';
import { useNow } from '../ui/lib/useNow';
import {
  fireNotification,
  permissionState,
  requestPermission,
  type PermissionState,
} from './notifications';
import {
  INITIAL_RUNTIME_STATE,
  loadPrefs,
  loadRuntimeState,
  savePrefs,
  saveRuntimeState,
  type ReminderRuntimeState,
} from './prefs';
import { disablePush, ensurePushSubscription, pushConfigured, syncScheduledPushes } from './push';

// setTimeout is unreliable for very long delays; cap scheduling and let the
// periodic re-process pick up anything beyond the cap as its time approaches.
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

export interface UseReminders {
  prefs: ReminderPrefs;
  permission: PermissionState;
  supported: boolean;
  setPrefs: (patch: Partial<ReminderPrefs>) => void;
  toggleSlotMuted: (slotId: string) => void;
  /** Request OS permission and, if granted, enable reminders. */
  enableNotifications: () => Promise<void>;
  catchUp: ScheduledReminder[];
  dismissCatchUp: () => void;
  /** True when background Web Push is available (backend + VAPID configured). */
  backgroundPushAvailable: boolean;
}

export function useReminders(): UseReminders {
  const slots = useStore((s) => s.slots);
  const medications = useStore((s) => s.medications);
  const doseLog = useStore((s) => s.doseLog);
  const settings = useStore((s) => s.settings);
  const hydrated = useStore((s) => s.hydrated);
  const now = useNow(30_000);

  const [prefs, setPrefsState] = useState<ReminderPrefs | null>(null);
  const [permission, setPermission] = useState<PermissionState>(() => permissionState());
  const [catchUp, setCatchUp] = useState<ScheduledReminder[]>([]);

  // Persisted bookkeeping; mutated through refs so re-renders don't reset it.
  const runtimeRef = useRef<ReminderRuntimeState>(INITIAL_RUNTIME_STATE);
  // The lastOpenAt captured at mount — the boundary for "came due while closed".
  const sessionBaselineRef = useRef<number>(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Load device-local prefs + runtime state once.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [p, rt] = await Promise.all([loadPrefs(), loadRuntimeState()]);
      if (!live) return;
      runtimeRef.current = rt;
      sessionBaselineRef.current = rt.lastOpenAt;
      setPrefsState(p);
    })();
    return () => {
      live = false;
    };
  }, []);

  const persistRuntime = useCallback((next: ReminderRuntimeState) => {
    runtimeRef.current = next;
    void saveRuntimeState(next);
  }, []);

  const markFired = useCallback(
    (id: string) => {
      const rt = runtimeRef.current;
      if (rt.firedIds.includes(id)) return false;
      persistRuntime({ ...rt, firedIds: [...rt.firedIds, id] });
      return true;
    },
    [persistRuntime],
  );

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
  }, []);

  // The engine: compute all pending reminders and route each one.
  useEffect(() => {
    if (!hydrated || !prefs) return;
    clearTimers();
    const baseline = sessionBaselineRef.current;
    const granted = permissionState() === 'granted';
    const fresh: ScheduledReminder[] = [];

    const dose = computeDoseReminders(slots, medications, doseLog, settings.zone, now, prefs);
    const followUps: ScheduledReminder[] = [];
    if (prefs.enabled && prefs.followUpEnabled) {
      const medById = new Map(medications.map((m) => [m.id, m]));
      for (const entry of doseLog) {
        if (entry.deleted || entry.status !== 'taken') continue;
        const med = medById.get(entry.medId);
        if (!med) continue;
        const r = followUpReminder(entry, med, now, prefs);
        if (r) followUps.push(r);
      }
    }

    const route = (r: ScheduledReminder) => {
      if (runtimeRef.current.firedIds.includes(r.id)) return;
      if (r.fireAt > now) {
        // Future: schedule a one-shot timer (capped) to fire while open.
        if (r.fireAt - now > MAX_TIMER_MS) return; // re-process will catch it later
        const t = setTimeout(
          () => {
            if (markFired(r.id) && permissionState() === 'granted') void fireNotification(r);
          },
          Math.max(0, r.fireAt - now),
        );
        timersRef.current.set(r.id, t);
        return;
      }
      // Overdue and not yet handled.
      if (r.fireAt > baseline) {
        // Came due while the app was closed → in-app catch-up (not an OS burst).
        if (markFired(r.id)) fresh.push(r);
      } else {
        // Pre-dates this session's knowledge; retire it silently.
        markFired(r.id);
      }
    };

    if (prefs.enabled) {
      for (const r of dose) route(r);
      for (const r of followUps) route(r);
    }

    // Missed-pattern alert: rising-edge, fires at most once per breach (AC3).
    if (prefs.enabled) {
      const adherence = computeAdherence(
        slots,
        medications,
        doseLog,
        settings.zone,
        settings.adherenceWindowDays,
        settings.missedDayThreshold,
        now,
        settings.assumeTakenOnTime ?? true,
      );
      const { reminder, state } = evaluateMissedPattern(
        adherence,
        { active: runtimeRef.current.missedActive },
        now,
      );
      if (reminder) {
        persistRuntime({ ...runtimeRef.current, missedActive: state.active });
        if (granted) void fireNotification(reminder);
        fresh.push(reminder);
      } else if (state.active !== runtimeRef.current.missedActive) {
        persistRuntime({ ...runtimeRef.current, missedActive: state.active });
      }
    }

    if (fresh.length > 0) {
      setCatchUp((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...fresh.filter((r) => !seen.has(r.id))];
      });
    }

    // Advance the open-marker for the NEXT session's catch-up boundary.
    persistRuntime({ ...runtimeRef.current, lastOpenAt: now });

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    prefs,
    permission,
    slots,
    medications,
    doseLog,
    settings.zone,
    settings.adherenceWindowDays,
    settings.missedDayThreshold,
    now,
  ]);

  // Background push relay: when enabled + permitted + configured, register this
  // device and mirror the upcoming reminders to the server so they deliver while
  // the app is closed. Recomputes only when the data/prefs change (not every
  // tick) to keep server writes minimal — `now` is read fresh inside instead.
  useEffect(() => {
    if (!hydrated || !prefs?.enabled || permission !== 'granted' || !pushConfigured()) return;
    let live = true;
    void (async () => {
      const ok = await ensurePushSubscription();
      if (!ok || !live) return;
      const at = Date.now();
      const dose = computeDoseReminders(slots, medications, doseLog, settings.zone, at, prefs);
      const followUps: ScheduledReminder[] = [];
      if (prefs.followUpEnabled) {
        const medById = new Map(medications.map((m) => [m.id, m]));
        for (const entry of doseLog) {
          if (entry.deleted || entry.status !== 'taken') continue;
          const med = medById.get(entry.medId);
          if (!med) continue;
          const r = followUpReminder(entry, med, at, prefs);
          if (r) followUps.push(r);
        }
      }
      await syncScheduledPushes([...dose, ...followUps]);
    })();
    return () => {
      live = false;
    };
    // Reads `Date.now()` fresh inside rather than depending on the ticking `now`,
    // so the relay re-runs on plan/pref changes — not every 30s tick.
  }, [hydrated, prefs, permission, slots, medications, doseLog, settings.zone]);

  const setPrefs = useCallback((patch: Partial<ReminderPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...(prev ?? ({} as ReminderPrefs)), ...patch } as ReminderPrefs;
      void savePrefs(next);
      // Turning reminders off on this device tears down its push subscription.
      if (patch.enabled === false) void disablePush();
      return next;
    });
  }, []);

  const toggleSlotMuted = useCallback((slotId: string) => {
    setPrefsState((prev) => {
      if (!prev) return prev;
      const muted = prev.mutedSlotIds.includes(slotId)
        ? prev.mutedSlotIds.filter((id) => id !== slotId)
        : [...prev.mutedSlotIds, slotId];
      const next = { ...prev, mutedSlotIds: muted };
      void savePrefs(next);
      return next;
    });
  }, []);

  const enableNotifications = useCallback(async () => {
    const result = await requestPermission();
    setPermission(result);
    if (result === 'granted') setPrefs({ enabled: true });
  }, [setPrefs]);

  const dismissCatchUp = useCallback(() => setCatchUp([]), []);

  return {
    prefs: prefs ?? { enabled: false, leadMinutes: 0, followUpEnabled: true, mutedSlotIds: [] },
    permission,
    supported: permission !== 'unsupported',
    setPrefs,
    toggleSlotMuted,
    enableNotifications,
    catchUp,
    dismissCatchUp,
    backgroundPushAvailable: pushConfigured(),
  };
}
