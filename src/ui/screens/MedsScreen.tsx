import { useState } from 'react';
import type { Medication } from '../../core';
import { useStore, type MedicationInput } from '../../store/store';
import { Button, Card, ColorDot, Field, inputClass } from '../components/ui';
import { Modal } from '../components/Modal';

const BLANK: MedicationInput = {
  name: '',
  color: '#0f766e',
  unit: 'mg',
  halfLifeHours: 12,
  adjustWhenLate: true,
  active: true,
  notes: '',
  guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
};

export function MedsScreen() {
  const medications = useStore((s) => s.medications);
  const deleteMedication = useStore((s) => s.deleteMedication);
  const [editing, setEditing] = useState<Medication | 'new' | null>(null);

  const visible = medications.filter((m) => !m.deleted);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Medications</h2>
        <Button onClick={() => setEditing('new')}>Add medication</Button>
      </div>

      {visible.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">No medications yet.</p>
        </Card>
      )}

      {visible.map((med) => (
        <Card key={med.id}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ColorDot color={med.color} />
                <span className="font-medium">{med.name}</span>
                {!med.active && <span className="text-xs text-slate-500">(inactive)</span>}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Half-life {med.halfLifeHours}h ·{' '}
                {med.adjustWhenLate ? 'timing-sensitive' : 'flexible'}
              </p>
              <p className="text-xs text-slate-500">
                Caps: single {fmt(med.guardrails.maxSingleDose, med.unit)}, daily{' '}
                {fmt(med.guardrails.maxDailyDose, med.unit)}, min interval{' '}
                {med.guardrails.minIntervalHours == null
                  ? '—'
                  : `${med.guardrails.minIntervalHours}h`}
              </p>
              {med.notes && <p className="mt-1 text-xs text-slate-400">{med.notes}</p>}
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <Button variant="secondary" onClick={() => setEditing(med)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => deleteMedication(med.id)}>
                Delete
              </Button>
            </div>
          </div>
        </Card>
      ))}

      {editing && (
        <MedEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function fmt(v: number | null, unit: string): string {
  return v == null ? '—' : `${v}${unit}`;
}

function MedEditor({ initial, onClose }: { initial: Medication | null; onClose: () => void }) {
  const addMedication = useStore((s) => s.addMedication);
  const updateMedication = useStore((s) => s.updateMedication);

  const [form, setForm] = useState<MedicationInput>(
    initial
      ? {
          name: initial.name,
          color: initial.color,
          unit: initial.unit,
          halfLifeHours: initial.halfLifeHours,
          adjustWhenLate: initial.adjustWhenLate,
          active: initial.active,
          notes: initial.notes ?? '',
          guardrails: { ...initial.guardrails },
        }
      : { ...BLANK },
  );

  const setG = (key: keyof MedicationInput['guardrails'], value: string) =>
    setForm((f) => ({
      ...f,
      guardrails: { ...f.guardrails, [key]: value === '' ? null : Number(value) },
    }));

  const save = () => {
    if (!form.name.trim()) return;
    if (initial) updateMedication(initial.id, form);
    else addMedication(form);
    onClose();
  };

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'Add medication'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            aria-label="Name"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit">
            <input
              className={inputClass}
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              aria-label="Unit"
            />
          </Field>
          <Field label="Half-life (hours)">
            <input
              type="number"
              min="0"
              step="any"
              className={inputClass}
              value={form.halfLifeHours}
              onChange={(e) => setForm({ ...form, halfLifeHours: Number(e.target.value) })}
              aria-label="Half-life hours"
            />
          </Field>
        </div>

        <Field label="Colour">
          <input
            type="color"
            className="h-9 w-16 rounded border border-slate-700 bg-slate-950"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            aria-label="Colour"
          />
        </Field>

        <fieldset className="grid grid-cols-3 gap-3 rounded-md border border-slate-800 p-3">
          <legend className="px-1 text-xs text-slate-400">Guardrails</legend>
          <Field label="Max single">
            <input
              type="number"
              min="0"
              step="any"
              className={inputClass}
              value={form.guardrails.maxSingleDose ?? ''}
              onChange={(e) => setG('maxSingleDose', e.target.value)}
              aria-label="Max single dose"
            />
          </Field>
          <Field label="Max daily">
            <input
              type="number"
              min="0"
              step="any"
              className={inputClass}
              value={form.guardrails.maxDailyDose ?? ''}
              onChange={(e) => setG('maxDailyDose', e.target.value)}
              aria-label="Max daily dose"
            />
          </Field>
          <Field label="Min interval (h)">
            <input
              type="number"
              min="0"
              step="any"
              className={inputClass}
              value={form.guardrails.minIntervalHours ?? ''}
              onChange={(e) => setG('minIntervalHours', e.target.value)}
              aria-label="Min interval hours"
            />
          </Field>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.adjustWhenLate}
            onChange={(e) => setForm({ ...form, adjustWhenLate: e.target.checked })}
          />
          Timing-sensitive (needs an adjusted dose when late)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Active
        </label>

        <Field label="Notes">
          <textarea
            className={inputClass}
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            aria-label="Notes"
          />
        </Field>

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!form.name.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
