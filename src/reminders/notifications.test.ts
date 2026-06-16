import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fireNotification,
  notificationsSupported,
  permissionState,
  requestPermission,
} from './notifications';
import type { ScheduledReminder } from '../core/reminders';

const reminder: ScheduledReminder = {
  id: 'dose:s1:2026-06-16',
  kind: 'dose',
  fireAt: 0,
  title: 'Medication reminder',
  body: 'A dose is due at 08:00.',
};

function setNotification(impl: unknown) {
  Object.defineProperty(window, 'Notification', { value: impl, configurable: true });
}

afterEach(() => {
  delete (window as { Notification?: unknown }).Notification;
  vi.restoreAllMocks();
});

describe('notifications adapter', () => {
  it('reports unsupported when the API is absent', async () => {
    expect(notificationsSupported()).toBe(false);
    expect(permissionState()).toBe('unsupported');
    expect(await requestPermission()).toBe('unsupported');
    expect(await fireNotification(reminder)).toBe(false);
  });

  it('does not fire when permission is denied (AC: permission-denied path)', async () => {
    const ctor = vi.fn();
    setNotification(Object.assign(ctor, { permission: 'denied' }));
    expect(permissionState()).toBe('denied');
    expect(await fireNotification(reminder)).toBe(false);
    expect(ctor).not.toHaveBeenCalled();
  });

  it('fires via the page Notification when granted and no SW is registered', async () => {
    const ctor = vi.fn();
    setNotification(Object.assign(ctor, { permission: 'granted' }));
    expect(await fireNotification(reminder)).toBe(true);
    expect(ctor).toHaveBeenCalledWith(
      'Medication reminder',
      expect.objectContaining({ tag: reminder.id }),
    );
  });

  it('passes through the requested permission result', async () => {
    const ctor = vi.fn();
    setNotification(
      Object.assign(ctor, {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      }),
    );
    expect(await requestPermission()).toBe('granted');
  });
});
