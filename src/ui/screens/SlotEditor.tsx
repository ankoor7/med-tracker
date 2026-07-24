// The time-centric editor: everything taken at one wall-clock time. Moved
// verbatim out of the old ScheduleScreen by Stage 18 FR-18.12 — the Meds tab
// now hosts it as the "By time" projection of the same slots the medication
// editor writes.

import { useState } from 'react';
import type { Medication, ScheduleItem, Slot } from '../../core';
import { useStore, type SlotInput } from '../../store/store';
import { Button, ColorDot, Field, inputClass, UNKNOWN_MED_NAME } from '../components/ui';
import { Modal } from '../components/Modal';

export function SlotEditor({ initial, onClose }: { initial: Slot | null; onClose: () => void }) {
  // Select the raw array (stable reference) and filter in render — filtering
  // inside the selector returns a new array each call, which trips React's
  // useSyncExternalStore into an infinite re-render loop (Zustand v5 / React 18).
  //
  // Two views of the same list: `medications` (all non-deleted, including
  // inactive) is what an existing item in this slot is looked up against —
  // AC10 forbids a raw id ever rendering, and a slot can already hold an
  // inactive medication (deactivating one doesn't remove it from its slots).
  // `activeMedications` (active only) is what a *new* item can be added
  // from — you can view and adjust an inactive medication's dose here, but
  // not newly schedule one.
  const medications = useStore((s) => s.medications).filter((m) => !m.deleted);
  const activeMedications = medications.filter((m) => m.active);
  const addSlot = useStore((s) => s.addSlot);
  const updateSlot = useStore((s) => s.updateSlot);

  const [time, setTime] = useState(initial?.time ?? '08:00');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [items, setItems] = useState<ScheduleItem[]>(initial ? [...initial.items] : []);

  const available = activeMedications.filter((m) => !items.some((i) => i.medId === m.id));

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
            {items.map((item) => (
              <SlotItemRow
                key={item.medId}
                item={item}
                med={medications.find((m) => m.id === item.medId)}
                onDose={(dose) => setDose(item.medId, dose)}
                onRemove={() => removeItem(item.medId)}
              />
            ))}
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

/** One medication line inside a time-slot: its dose here, and a way out. */
function SlotItemRow({
  item,
  med,
  onDose,
  onRemove,
}: {
  item: ScheduleItem;
  med: Medication | undefined;
  onDose: (dose: number) => void;
  onRemove: () => void;
}) {
  const name = med?.name ?? UNKNOWN_MED_NAME;
  return (
    <li className="flex items-center gap-2">
      <ColorDot color={med?.color ?? '#64748b'} />
      <span className="flex-1 truncate text-sm">{name}</span>
      <input
        type="number"
        min="0"
        step="any"
        className={`${inputClass} w-24`}
        value={item.dose}
        onChange={(e) => onDose(Number(e.target.value))}
        aria-label={`Dose for ${name}`}
      />
      <span className="w-8 text-xs text-slate-400">{med?.unit}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800"
      >
        ✕
      </button>
    </li>
  );
}
