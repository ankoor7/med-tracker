import { useStore } from '../../store/store';
import { useRemindersContext } from '../../reminders/reminderContext';
import { Button, Card, Field, inputClass } from './ui';

// Reminder settings (Stage 6): permission UX, global enable + lead time,
// per-slot mute toggles, and an honest note on platform limits (FR-6.5).
export function RemindersPanel() {
  const { prefs, permission, supported, setPrefs, toggleSlotMuted, enableNotifications } =
    useRemindersContext();
  const slots = useStore((s) => s.slots).filter((s) => !s.deleted);

  return (
    <Card>
      <h3 className="mb-2 text-sm font-medium">Reminders</h3>

      {!supported ? (
        <p className="text-sm text-status-due">
          This browser does not support notifications. Doses you miss while the app is closed are
          shown as catch-up when you reopen it.
        </p>
      ) : permission !== 'granted' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-400">
            Get a nudge when a dose is due. Reminders are stored on this device only and never
            mention how much to take.
          </p>
          <div>
            <Button variant="secondary" onClick={() => void enableNotifications()}>
              {permission === 'denied'
                ? 'Notifications blocked — enable in browser'
                : 'Enable reminders'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs.enabled}
              onChange={(e) => setPrefs({ enabled: e.target.checked })}
            />
            <span>Dose reminders enabled</span>
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Notify ahead (minutes)">
              <input
                type="number"
                min="0"
                className={inputClass}
                value={prefs.leadMinutes}
                onChange={(e) => setPrefs({ leadMinutes: Math.max(0, Number(e.target.value)) })}
                aria-label="Notify ahead minutes"
              />
            </Field>
            <label className="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={prefs.followUpEnabled}
                onChange={(e) => setPrefs({ followUpEnabled: e.target.checked })}
              />
              <span>Follow-up after a late dose</span>
            </label>
          </div>

          {slots.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-slate-400">Per-slot reminders</p>
              <ul className="flex flex-col gap-1">
                {slots.map((slot) => (
                  <li key={slot.id} className="flex items-center justify-between text-sm">
                    <span>
                      {slot.time}
                      {slot.label ? ` · ${slot.label}` : ''}
                    </span>
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={!prefs.mutedSlotIds.includes(slot.id)}
                        onChange={() => toggleSlotMuted(slot.id)}
                      />
                      <span>on</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Web notifications only fire while the app is open or installed; background delivery is
        limited and varies by platform. Missed reminders appear as in-app catch-up on reopen.
      </p>
    </Card>
  );
}
