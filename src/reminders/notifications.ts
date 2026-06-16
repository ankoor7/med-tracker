// Browser notification adapter (Stage 6). Thin, impure glue around the
// Notifications API + service-worker registration. All timing/content decisions
// live in `core/reminders.ts`; this module only asks permission and fires.
//
// Platform honesty (FR-6.5): the Web Notifications API can only reliably fire
// while a page/SW context is alive. We do not promise background delivery; when
// the app is closed, reminders are surfaced as in-app catch-up on next open.

import type { ScheduledReminder } from '../core/reminders';

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissionState(): PermissionState {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission as PermissionState;
}

export async function requestPermission(): Promise<PermissionState> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return (await Notification.requestPermission()) as PermissionState;
  } catch {
    return permissionState();
  }
}

/**
 * Fire a notification now. Prefers the service-worker registration (works in
 * more contexts, e.g. installed PWA) and falls back to a page Notification.
 * Returns whether it was shown. The `tag` dedupes repeats of the same reminder.
 */
export async function fireNotification(reminder: ScheduledReminder): Promise<boolean> {
  if (permissionState() !== 'granted') return false;
  const options: NotificationOptions = {
    body: reminder.body,
    tag: reminder.id,
    icon: '/icon.svg',
    badge: '/icon.svg',
  };
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(reminder.title, options);
        return true;
      }
    }
    new Notification(reminder.title, options);
    return true;
  } catch {
    return false;
  }
}
