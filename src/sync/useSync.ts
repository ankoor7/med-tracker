// React binding for the sync engine (Stage 5).
//
// Owns sync status and the triggers: an initial sync when enabled, on window
// focus, on coming back online, and a debounced sync after local mutations. A
// manual `syncNow` is exposed for the Account panel button. After a sync that
// merged remote changes, it reloads the store so the UI reflects them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getRepository } from '../store/repository';
import { useStore } from '../store/store';
import { ApiError } from './apiClient';
import { defaultBackend, runSync, type PushResult, type SyncBackend } from './syncEngine';

export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncedAt: number | null;
  rejections: PushResult[];
  error: string | null;
}

const MUTATION_DEBOUNCE_MS = 1500;

const INITIAL: SyncStatus = { phase: 'idle', lastSyncedAt: null, rejections: [], error: null };

export interface UseSync {
  status: SyncStatus;
  syncNow: () => Promise<void>;
}

/**
 * @param enabled true when a backend is configured and the user is signed in.
 * @param backend injectable for tests; defaults to the authorized API client.
 */
export function useSync(enabled: boolean, backend: SyncBackend = defaultBackend): UseSync {
  const [status, setStatus] = useState<SyncStatus>(INITIAL);
  const reload = useStore((s) => s.reload);

  // Guard against overlapping runs and stale async writes after unmount.
  const running = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const syncNow = useCallback(async () => {
    if (!enabled || running.current) return;
    running.current = true;
    if (live.current) setStatus((s) => ({ ...s, phase: 'syncing', error: null }));
    try {
      const result = await runSync(getRepository(), backend);
      if (result.applied > 0) await reload();
      if (live.current) {
        setStatus({
          phase: 'synced',
          lastSyncedAt: Date.now(),
          rejections: result.rejected,
          error: null,
        });
      }
    } catch (err) {
      // A network failure is an expected offline state, not a hard error.
      const offline = !(err instanceof ApiError) || err.status === 0;
      if (live.current) {
        setStatus((s) => ({
          ...s,
          phase: offline ? 'offline' : 'error',
          error: err instanceof Error ? err.message : 'sync failed',
        }));
      }
    } finally {
      running.current = false;
    }
  }, [enabled, backend, reload]);

  // Trigger: enable → initial sync; window focus; back online.
  useEffect(() => {
    if (!enabled) return;
    void syncNow();
    const onFocus = () => void syncNow();
    const onOnline = () => void syncNow();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, syncNow]);

  // Trigger: debounced sync after local data mutations. Reloading the store
  // after a pull also changes these slices, but that settles in one extra empty
  // round (no records applied → no reload → no further trigger).
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), MUTATION_DEBOUNCE_MS);
    };
    const unsub = useStore.subscribe((state, prev) => {
      if (
        state.medications !== prev.medications ||
        state.slots !== prev.slots ||
        state.doseLog !== prev.doseLog ||
        state.settings !== prev.settings
      ) {
        schedule();
      }
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [enabled, syncNow]);

  return { status, syncNow };
}
