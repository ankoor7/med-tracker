import { useState } from 'react';
import type { ScheduleItem, Slot } from '../../core';
import { useStore, type SlotInput } from '../../store/store';
import { Button, Card, ColorDot, Field, inputClass } from '../components/ui';
import { Modal } from '../components/Modal';

export function ScheduleScreen() {
  const slots = useStore((s) => s.slots);
  const deleteSlot = useStore((s) => s.deleteSlot);
  const medications = useStore((s) => s.medications);
  const [editing, setEditing] = useState<Slot | 'new' | null>(null);

  const medById = new Map(medications.map((m) => [m.id, m]));
  const visible = [...slots.filter((s) => !s.deleted)].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Schedule</h2>
        <Button onClick={() => setEditing('new')}>Add time-slot</Button>
      </div>

      {visible.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">No time-slots yet.</p>
        </Card>
      )}

      {visible.map((slot) => (
        <Card key={slot.id}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold">{slot.time}</span>
                {slot.label && <span className="text-sm text-slate-400">{slot.label}</span>}
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {slot.items.map((item) => {
                  const med = medById.get(item.medId);
                  return (
                    <li key={item.medId} className="flex items-center gap-2 text-sm">
                      <ColorDot color={med?.color ?? '#64748b'} />
                      <span>{med?.name ?? item.medId}</span>
                      <span className="text-xs text-slate-400">
                        {item.dose}
                        {med?.unit ?? ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <Button variant="secondary" onClick={() => setEditing(slot)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => deleteSlot(slot.id)}>
                Delete
              </Button>
            </div>
          </div>
        </Card>
      ))}

      {editing && (
        <SlotEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function SlotEditor({ initial, onClose }: { initial: Slot | null; onClose: () => void }) {
  const medications = useStore((s) => s.medications.filter((m) => !m.deleted && m.active));
  const addSlot = useStore((s) => s.addSlot);
  const updateSlot = useStore((s) => s.updateSlot);

  const [time, setTime] = useState(initial?.time ?? '08:00');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [items, setItems] = useState<ScheduleItem[]>(initial ? [...initial.items] : []);

  const available = medications.filter((m) => !items.some((i) => i.medId === m.id));

  const addItem = (medId: string) => {
    if (!medId) return;
    setItems((it) => [...it, { medId, dose: 0 }]);
  };
  const setDose = (medId: string, dose: number) =>
    setItems((it) => it.map((i) => (i.medId === medId ? { ...i, dose } : i)));
  const removeItem = (medId: string) => setItems((it) => it.filter((i) => i.medId !== medId));

  const valid = /^\d{2}:\d{2}$/.test(time) && items.length >= 1 && items.every((i) => i.dose > 0);

  const save = () => {
    if (!valid) return;
    const payload: SlotInput = { time, label: label.trim() || undefined, items };
    if (initial) updateSlot(initial.id, payload);
    else addSlot(payload);
    onClose();
  };

  return (
    <Modal title={initial ? 'Edit time-slot' : 'Add time-slot'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Time (wall-clock)">
            <input
              type="time"
              className={inputClass}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Time"
            />
          </Field>
          <Field label="Label (optional)">
            <input
              className={inputClass}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Morning"
              aria-label="Label"
            />
          </Field>
        </div>

        <div className="rounded-md border border-slate-800 p-3">
          <p className="mb-2 text-xs text-slate-400">Medications in this slot</p>
          {items.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const med = medications.find((m) => m.id === item.medId);
              return (
                <li key={item.medId} className="flex items-center gap-2">
                  <ColorDot color={med?.color ?? '#64748b'} />
                  <span className="flex-1 truncate text-sm">{med?.name ?? item.medId}</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className={`${inputClass} w-24`}
                    value={item.dose}
                    onChange={(e) => setDose(item.medId, Number(e.target.value))}
                    aria-label={`Dose for ${med?.name ?? item.medId}`}
                  />
                  <span className="w-8 text-xs text-slate-400">{med?.unit}</span>
                  <button
                    type="button"
                    onClick={() => removeItem(item.medId)}
                    aria-label={`Remove ${med?.name ?? item.medId}`}
                    className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>

          {available.length > 0 && (
            <select
              className={`${inputClass} mt-3 w-full`}
              value=""
              onChange={(e) => addItem(e.target.value)}
              aria-label="Add medication to slot"
            >
              <option value="">+ Add medication…</option>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {!valid && items.length > 0 && (
          <p className="text-xs text-amber-400">Every medication needs a dose greater than 0.</p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
