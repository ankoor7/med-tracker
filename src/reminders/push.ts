// Background Web Push relay (Stage 6 follow-up) — client side.
//
// The web platform can't reliably wake a *closed* PWA on its own, so we relay:
// the client computes reminder timing (core/reminders.ts) and mirrors upcoming
// reminders into the `scheduled_pushes` table, registering this device's push
// subscription. The send-push Edge Function then delivers due rows even when the
// app is closed. The server does no schedule math — it just delivers.
//
// All of this is gated on a configured backend AND a VAPID public key; with
// neither (pure local-first), every function here is a no-op and the app falls
// back to in-app catch-up.

import { isBackendConfigured } from '../config';
import { getSupabase } from '../supabase/client';
import type { ScheduledReminder } from '../core/reminders';

export function vapidPublicKey(): string | null {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return key && key.length > 0 ? key : null;
}

/** True only when background push is fully available (backend + VAPID + APIs). */
export function pushConfigured(): boolean {
  return (
    isBackendConfigured() &&
    vapidPublicKey() != null &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  );
}

// VAPID keys are URL-safe base64; the subscribe() API wants a Uint8Array backed
// by a plain ArrayBuffer (BufferSource).
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ensure this device has a push subscription registered server-side. */
export async function ensurePushSubscription(): Promise<boolean> {
  if (!pushConfigured()) return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey()!),
    });
  }
  const json = sub.toJSON();
  const keys = json.keys ?? {};
  if (!keys.p256dh || !keys.auth) return false;
  // user_id defaults to auth.uid() on the server; RLS confines the row to us.
  const { error } = await getSupabase().from('push_subscriptions').upsert(
    { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth },
    {
      onConflict: 'endpoint',
    },
  );
  return !error;
}

// Encode the take-deeplink a dose reminder carries so a tapped notification can
// record the dose the user already scheduled (never an amount).
function takeUrl(r: ScheduledReminder): { url: string; canTake: boolean } {
  if (r.kind === 'dose' && r.slotId && r.scheduledInstant != null) {
    return { url: `/?take=${encodeURIComponent(r.slotId)}|${r.scheduledInstant}`, canTake: true };
  }
  return { url: '/', canTake: false };
}

/**
 * Mirror the upcoming reminders to the server so they deliver while the app is
 * closed. Upserts future reminders and prunes stale unsent rows (e.g. a dose was
 * taken or the schedule changed), so the relay always reflects the latest plan.
 */
export async function syncScheduledPushes(reminders: ScheduledReminder[]): Promise<void> {
  if (!pushConfigured()) return;
  const now = Date.now();
  const rows = reminders
    .filter((r) => r.fireAt > now)
    .map((r) => {
      const { url, canTake } = takeUrl(r);
      return { id: r.id, fire_at: r.fireAt, title: r.title, body: r.body, url, can_take: canTake };
    });

  const supabase = getSupabase();
  if (rows.length > 0) {
    await supabase.from('scheduled_pushes').upsert(rows, { onConflict: 'user_id,id' });
  }

  // Prune future, unsent rows that are no longer scheduled.
  const keep = new Set(rows.map((r) => r.id));
  const { data: existing } = await supabase
    .from('scheduled_pushes')
    .select('id')
    .eq('sent', false)
    .gt('fire_at', now);
  const stale = (existing ?? []).map((e) => e.id as string).filter((id) => !keep.has(id));
  if (stale.length > 0) {
    await supabase.from('scheduled_pushes').delete().in('id', stale);
  }
}

/** Best-effort teardown when the user turns reminders off on this device. */
export async function disablePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      if (isBackendConfigured()) {
        await getSupabase().from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
      await sub.unsubscribe();
    }
  } catch {
    // Non-fatal: the row is owner-scoped and the subscription expires anyway.
  }
}

/** Parse a `?take=slotId|scheduledInstant` deeplink into a take instruction. */
export function parseTakeParam(
  search: string,
): { slotId: string; scheduledInstant: number } | null {
  const params = new URLSearchParams(search);
  const raw = params.get('take');
  if (!raw) return null;
  const sep = raw.lastIndexOf('|');
  if (sep <= 0) return null;
  const slotId = decodeURIComponent(raw.slice(0, sep));
  const scheduledInstant = Number(raw.slice(sep + 1));
  if (!slotId || !Number.isFinite(scheduledInstant)) return null;
  return { slotId, scheduledInstant };
}
