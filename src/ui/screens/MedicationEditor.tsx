// Stage 18 FR-18.12 — the merged medication editor.
//
// One form owns a medication end to end: what it is, what it is capped at,
// when it is taken and how much at each time. Dose stays per-time-of-day (a
// patient may take 150mg in the morning and 100mg at night), so the "Times &
// doses" list is a list of slot memberships, not a single amount.
//
// The form only ever calls the existing store actions — `addMedication` /
// `updateMedication` for the medication, and `addSlot` / `updateSlot` /
// `deleteSlot` for each slot the plan touches — so the Stage 16 change records
// are identical to those the old two-tab flow emitted.

import { useState } from 'react';
import {
  coScheduledAtTime,
  duplicateTimes,
  isValidTime,
  isoDateInZone,
  planSlotOps,
  rowsForMedication,
  startOfDayInstant,
  validateMedication,
  type MedTimeRow,
  type MedicationValidationIssue,
  type SharedTime,
  type Medication,
} from '../../core';
import { useStore, type MedicationInput } from '../../store/store';
import { Button, Field, inputClass } from '../components/ui';
import { Modal } from '../components/Modal';
import { StartDateField } from '../components/StartDateField';

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

/** A row plus the local key React needs while the row has no slot yet. */
interface EditableRow extends MedTimeRow {
  key: string;
}

let rowSeq = 0;
const newRowKey = () => `row-${++rowSeq}`;

export function MedicationEditor({
  initial,
  onClose,
}: {
  initial: Medication | null;
  onClose: () => void;
}) {
  // Only the values this form renders are subscribed to. The mutating actions
  // are stable, and are read from the store at save time along with the slots
  // the plan is computed against.
  const zone = useStore((s) => s.settings.zone);
  const doseLog = useStore((s) => s.doseLog);
  const medications = useStore((s) => s.medications);

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
  // A start date is captured going forward (FR-18.1 piece 3): a new medication
  // defaults to today so the upgrade prompt stays a one-off for existing data;
  // an existing medication with no `startedAt` is left blank rather than
  // forcing one — "always existed" is a valid answer too. Kept as the wall-
  // clock ISO string the date input speaks; converted to an Instant on save.
  const [startDateStr, setStartDateStr] = useState<string>(() =>
    initial
      ? initial.startedAt != null
        ? isoDateInZone(initial.startedAt, zone)
        : ''
      : isoDateInZone(Date.now(), zone),
  );

  const [rows, setRows] = useState<EditableRow[]>(() =>
    initial
      ? rowsForMedication(useStore.getState().slots, initial.id).map((r) => ({
          ...r,
          key: newRowKey(),
        }))
      : [{ key: newRowKey(), time: '08:00', dose: 0 }],
  );

  const setG = (key: keyof MedicationInput['guardrails'], value: string) =>
    setForm((f) => ({
      ...f,
      guardrails: { ...f.guardrails, [key]: value === '' ? null : Number(value) },
    }));

  const patchRow = (key: string, patch: Partial<MedTimeRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));
  const addRow = () =>
    setRows((rs) => [
      ...rs,
      { key: newRowKey(), time: rs.length === 0 ? '08:00' : '20:00', dose: 0 },
    ]);

  // A snapshot of the regimen as it was when the editor opened, used only to
  // tell the user which times they share with another medication.
  const [openedWith] = useState(() => {
    const st = useStore.getState();
    return { slots: st.slots, names: new Map(st.medications.map((m) => [m.id, m.name])) };
  });
  const sharedWith = (row: MedTimeRow): SharedTime & { names: string[] } => {
    const shared = coScheduledAtTime(openedWith.slots, row, initial?.id ?? '');
    return {
      ...shared,
      names: shared.medIds
        .map((id) => openedWith.names.get(id))
        .filter((n): n is string => n != null),
    };
  };

  const dupes = duplicateTimes(rows);
  const badTime = rows.some((r) => !isValidTime(r.time));
  const badDose = rows.some((r) => !(r.dose > 0));

  // FR-18.7 (no medication is silently left unscheduled) and FR-18.8 (duplicate
  // names, non-positive guardrails, daily total vs cap) — validated in the pure
  // core (`core/medicationValidation.ts`) so the rules are unit-testable and
  // this component only renders what comes back.
  const issues = validateMedication({
    name: form.name,
    guardrails: form.guardrails,
    slotDoses: rows.map((r) => r.dose),
    medId: initial?.id,
    others: medications,
    unit: form.unit,
  });
  const issueFor = (field: MedicationValidationIssue['field']) =>
    issues.find((i) => i.field === field);
  const canSave = issues.length === 0 && !badTime && !badDose && dupes.length === 0;

  const save = () => {
    if (!canSave) return;
    const payload: MedicationInput = {
      ...form,
      startedAt: startDateStr === '' ? undefined : startOfDayInstant(startDateStr, zone),
    };
    const store = useStore.getState();
    // One Save is one regimen edit, however many store actions it takes: the
    // bracket collapses them into a single `ScheduleSnapshot` of the final
    // state (FR-18.1 follow-up). Without it the actions below each snapshot
    // themselves in the same millisecond, and a past day could resolve to an
    // intermediate regimen that was never saved.
    store.runRegimenEdit(() => {
      // The medication first: a new one has to exist before its slots can name it.
      let medId: string;
      if (initial) {
        store.updateMedication(initial.id, payload);
        medId = initial.id;
      } else {
        medId = store.addMedication(payload).id;
      }

      // Re-read slots rather than using the render-time snapshot — the medication
      // write above may have cascaded (it does on deactivation).
      const plan = planSlotOps(medId, rows, useStore.getState().slots);
      for (const op of plan) {
        if (op.kind === 'add-slot') store.addSlot({ time: op.time, items: [op.item] });
        else if (op.kind === 'update-slot') store.updateSlot(op.slotId, op.patch);
        else store.deleteSlot(op.slotId);
      }
    });
    onClose();
  };

  const unit = form.unit || '';

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'Add medication'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <IdentityFields
          form={form}
          nameError={issueFor('name')?.message}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        />

        <StartDateField
          label="Start date"
          value={startDateStr}
          onChange={setStartDateStr}
          zone={zone}
          doseLog={doseLog}
          medId={initial?.id}
        />

        {/* The half of the regimen that used to live on a separate tab. */}
        <TimesFieldset
          rows={rows}
          unit={unit}
          dupes={dupes}
          badTime={badTime}
          badDose={badDose}
          scheduleError={issueFor('schedule')?.message}
          dailyTotalError={issueFor('dailyTotal')?.message}
          sharedWith={sharedWith}
          onPatchRow={patchRow}
          onRemoveRow={removeRow}
          onAddRow={addRow}
        />

        <GuardrailsFieldset
          guardrails={form.guardrails}
          errors={{
            maxSingleDose: issueFor('maxSingleDose')?.message,
            maxDailyDose: issueFor('maxDailyDose')?.message,
            minIntervalHours: issueFor('minIntervalHours')?.message,
          }}
          onChange={setG}
        />

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
          <Button onClick={save} disabled={!canSave}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** What the medication is: name, unit, half-life, colour. */
function IdentityFields({
  form,
  nameError,
  onChange,
}: {
  form: MedicationInput;
  nameError?: string;
  onChange: (patch: Partial<MedicationInput>) => void;
}) {
  return (
    <>
      <Field label="Name">
        <input
          className={inputClass}
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-label="Name"
          aria-invalid={nameError != null}
        />
      </Field>
      {/* FR-18.8: a specific, actionable message — empty or duplicate name. */}
      {nameError && <p className="-mt-2 text-xs text-red-300">{nameError}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Unit">
          <input
            className={inputClass}
            value={form.unit}
            onChange={(e) => onChange({ unit: e.target.value })}
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
            onChange={(e) => onChange({ halfLifeHours: Number(e.target.value) })}
            aria-label="Half-life hours"
          />
        </Field>
      </div>

      <Field label="Colour">
        <input
          type="color"
          className="h-9 w-16 rounded border border-slate-700 bg-slate-950"
          value={form.color}
          onChange={(e) => onChange({ color: e.target.value })}
          aria-label="Colour"
        />
      </Field>
    </>
  );
}

/** The caps the app validates a logged dose against — never originates one. */
function GuardrailsFieldset({
  guardrails,
  errors,
  onChange,
}: {
  guardrails: MedicationInput['guardrails'];
  errors: Partial<Record<keyof MedicationInput['guardrails'], string>>;
  onChange: (key: keyof MedicationInput['guardrails'], value: string) => void;
}) {
  const fields: Array<[keyof MedicationInput['guardrails'], string, string]> = [
    ['maxSingleDose', 'Max single', 'Max single dose'],
    ['maxDailyDose', 'Max daily', 'Max daily dose'],
    ['minIntervalHours', 'Min interval (h)', 'Min interval hours'],
  ];
  return (
    <fieldset className="rounded-md border border-slate-800 p-3">
      <legend className="px-1 text-xs text-slate-400">Guardrails</legend>
      <div className="grid grid-cols-3 gap-3">
        {fields.map(([key, label, ariaLabel]) => (
          <Field key={key} label={label}>
            <input
              type="number"
              min="0"
              step="any"
              className={inputClass}
              value={guardrails[key] ?? ''}
              onChange={(e) => onChange(key, e.target.value)}
              aria-label={ariaLabel}
              aria-invalid={errors[key] != null}
            />
          </Field>
        ))}
      </div>
      {/* FR-18.8: a negative or zero cap, and the daily total vs maxDailyDose. */}
      {fields.map(
        ([key]) =>
          errors[key] && (
            <p key={key} className="mt-2 text-xs text-red-300">
              {errors[key]}
            </p>
          ),
      )}
    </fieldset>
  );
}

/**
 * The "times & doses" list — the medication's slot memberships, one row each.
 * Dose is per time of day by design: a morning and an evening amount differ.
 */
function TimesFieldset({
  rows,
  unit,
  dupes,
  badTime,
  badDose,
  scheduleError,
  dailyTotalError,
  sharedWith,
  onPatchRow,
  onRemoveRow,
  onAddRow,
}: {
  rows: EditableRow[];
  unit: string;
  dupes: string[];
  badTime: boolean;
  badDose: boolean;
  scheduleError?: string;
  dailyTotalError?: string;
  sharedWith: (row: MedTimeRow) => SharedTime & { names: string[] };
  onPatchRow: (key: string, patch: Partial<MedTimeRow>) => void;
  onRemoveRow: (key: string) => void;
  onAddRow: () => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-slate-800 p-3">
      <legend className="px-1 text-xs text-slate-400">Times &amp; doses</legend>
      <p className="text-xs text-slate-500">
        Each time can carry a different amount — a morning and an evening dose need not match.
      </p>
      {/* FR-18.7: zero times blocks Save outright — no PRN/as-needed concept
          exists in the domain (see core/types.ts Medication), so a medication
          with nothing scheduled would otherwise be silently invisible. */}
      {rows.length === 0 && (
        <p className="text-sm text-red-300">
          {scheduleError ??
            'Add at least one time — without one this medication will not appear on Today.'}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li key={row.key} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                type="time"
                className={`${inputClass} w-28`}
                value={row.time}
                onChange={(e) => onPatchRow(row.key, { time: e.target.value })}
                aria-label={`Time for dose ${i + 1}`}
              />
              <input
                type="number"
                min="0"
                step="any"
                className={`${inputClass} w-24`}
                value={row.dose}
                onChange={(e) => onPatchRow(row.key, { dose: Number(e.target.value) })}
                aria-label={`Amount for dose ${i + 1}`}
              />
              <span className="w-8 shrink-0 text-xs text-slate-400">{unit}</span>
              <button
                type="button"
                onClick={() => onRemoveRow(row.key)}
                aria-label={`Remove dose ${i + 1}`}
                className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 focus-visible:bg-slate-800"
              >
                ✕
              </button>
            </div>
            <SharedTimeNote shared={sharedWith(row)} time={row.time} />
          </li>
        ))}
      </ul>
      <div>
        <Button variant="secondary" onClick={onAddRow}>
          Add a time
        </Button>
      </div>
      {dupes.length > 0 && (
        <p className="text-xs text-amber-400">
          {dupes.join(', ')} is listed twice — combine it into one dose.
        </p>
      )}
      {badTime && <p className="text-xs text-amber-400">Every time needs to be set.</p>}
      {!badTime && badDose && (
        <p className="text-xs text-amber-400">Every time needs an amount greater than 0.</p>
      )}
      {/* FR-18.8: the daily total across every slot vs the medication's own cap. */}
      {dailyTotalError && <p className="text-xs text-red-300">{dailyTotalError}</p>}
    </fieldset>
  );
}

/**
 * Disclose that a time is shared. Two cases, because the consequence differs:
 * editing a time already shared moves everyone else's dose with it, whereas
 * moving onto an occupied time starts sharing with medications this one was
 * previously independent of.
 */
function SharedTimeNote({
  shared,
  time,
}: {
  shared: SharedTime & { names: string[] };
  time: string;
}) {
  if (shared.names.length === 0) return null;
  const others = shared.names.join(', ');
  return (
    <p className="pl-1 text-xs text-slate-400">
      {shared.joining
        ? `Moving to ${time} groups this dose with ${others}, already taken then.`
        : `${time} is shared with ${others} — changing this time moves their dose too.`}
    </p>
  );
}
