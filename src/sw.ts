/// <reference lib="webworker" />
//
// Custom service worker (Stage 6 follow-up — background Web Push).
//
// vite-plugin-pwa builds this with the `injectManifest` strategy: it precaches
// the app shell (so the PWA stays offline-capable) and adds `push` +
// `notificationclick` handlers so reminders delivered by the send-push Edge
// Function arrive even when the app is fully closed.
//
// Safety invariant (FR-6.6): a push never carries a dose *value* — only that a
// dose is due. The "Mark taken" action records the scheduled dose the user
// already set; the app never originates an amount.

import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

// Injected at build time by vite-plugin-pwa.
precacheAndRoute(self.__WB_MANIFEST);

// Activate immediately so push works without waiting for all tabs to close
// (registerType is 'autoUpdate').
self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  /** Where a click should take the user; carries `?take=…` for dose reminders. */
  url?: string;
  /** When true, offer a "Mark taken" action. */
  canTake?: boolean;
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload;
  try {
    payload = event.data?.json() as PushPayload;
  } catch {
    payload = { title: 'SteadyDose', body: event.data?.text() ?? 'Reminder' };
  }
  const actions = payload.canTake
    ? [
        { action: 'taken', title: 'Mark taken' },
        { action: 'open', title: 'Open' },
      ]
    : [];
  const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
    body: payload.body,
    tag: payload.tag,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: payload.url ?? '/' },
    actions,
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: string };
  const takeUrl = data.url ?? '/';
  // Only the explicit "Mark taken" action records a dose; a plain click or
  // "Open" just brings the app forward (stripped of the take instruction).
  const isTake = event.action === 'taken';
  const openUrl = isTake ? takeUrl : (takeUrl.split('?')[0] ?? '/');

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        await client.focus();
        // Tell the open tab to record the dose without a reload.
        if (isTake) client.postMessage({ type: 'steadydose:take', url: takeUrl });
        return;
      }
      // No open tab: open one. A cold-started app parses `?take=…` on boot.
      await self.clients.openWindow(openUrl);
    })(),
  );
});
