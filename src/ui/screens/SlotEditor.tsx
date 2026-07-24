// The time-centric editor: everything taken at one wall-clock time. Moved
// verbatim out of the old ScheduleScreen by Stage 18 FR-18.12 — the Meds tab
// now hosts it as the "By time" projection of the same slots the medication
// editor writes.
//
// Stage 20 Unit 3: migrated onto React Aria form primitives. The medication
// picker is now a `Select` (FR-20.1), and time / dose entry use `TimeField` /
// `NumberField`. Store actions (`addSlot` / `updateSlot`) are unchanged.

import { useState } from 'react';
import {
  Button as RACButton,
  Form,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from 'react-aria-components';
import type { Medication, ScheduleItem, Slot } from '../../core';
import { useStore, type SlotInput } from '../../store/store';
import { Button, ColorDot, UNKNOWN_MED_NAME } from '../components/ui';
import { NumberField, TextField, TimeField } from '../components/fields';
import { fromTimeValue, toTimeValue } from '../components/timeValue';
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
      <Form
        validationBehavior="aria"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <TimeField
            label="Time"
            aria-label="Time"
            hint="Wall-clock."
            value={toTimeValue(time)}
            onChange={(t) => setTime(fromTimeValue(t))}
          />
          <TextField
            label="Label (optional)"
            aria-label="Label"
            value={label}
            onChange={setLabel}
            placeholder="Morning"
          />
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
            <Select
              aria-label="Add medication to slot"
              data-testid="add-med-select"
              selectedKey={null}
              onSelectionChange={(key) => addItem(String(key))}
              className="mt-3 w-full"
            >
              <RACButton className={`${SELECT_TRIGGER} w-full`}>
                <SelectValue>{() => '+ Add medication…'}</SelectValue>
                <span aria-hidden className="text-slate-400">
                  ▾
                </span>
              </RACButton>
              <Popover className="w-[--trigger-width] overflow-auto rounded-xl border border-white/10 bg-slate-900/95 p-1 shadow-soft backdrop-blur-md">
                <ListBox items={available}>
                  {(m) => (
                    <ListBoxItem
                      id={m.id}
                      textValue={m.name}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[focused]:bg-accent/15 data-[selected]:bg-accent/10"
                    >
                      <ColorDot color={m.color} />
                      {m.name}
                    </ListBoxItem>
                  )}
                </ListBox>
              </Popover>
            </Select>
          )}
        </div>

        {!valid && items.length > 0 && (
          <p role="alert" className="text-xs text-status-due">
            Every medication needs a dose greater than 0.
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid}>
            Save
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

const SELECT_TRIGGER =
  'flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-left text-sm text-slate-100 outline-none data-[focus-visible]:border-accent-muted data-[hovered]:border-white/20';

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
      <NumberField
        aria-label={`Dose for ${name}`}
        value={item.dose}
        onChange={onDose}
        inputClassName="w-24"
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
