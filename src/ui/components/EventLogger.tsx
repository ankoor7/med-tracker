// The "log / edit an event instance" modal. Moved out of
// `screens/EventsScreen.tsx` by Stage 24 (FR-24.3), which needs the *same*
// dialog reachable from a Today dose row — a screen importing another screen
// would be the wrong shape, so the shared form lives here next to `DoseLogger`.
// The move is otherwise behaviour-preserving; what is new is the attribution
// block (FR-24.2) and the no-types-yet quick create.
//
// Clinical-safety note: attribution is the user's **stated** association and
// nothing here may read as a causal claim. The copy says "attributed to" — not
// "caused by", "linked to", or "side effect of". SteadyDose records the
// association; it never computes, infers, endorses or acts on one.

import { useState } from 'react';
import { Form } from 'react-aria-components';
import {
  DEFAULT_EVENT_PROPERTIES,
  datetimeLocalToInstant,
  formatDateTimeWithZone,
  instantToDatetimeLocal,
  scaleRange,
  validateEventAttribution,
  validateEventInstanceValues,
  type DoseLogEntry,
  type EventAttribution,
  type EventInstance,
  type EventPropertyDef,
  type EventPropertyValue,
  type EventType,
  type Medication,
} from '../../core';
import { useStore, type EventInstanceInput } from '../../store/store';
import { Button, Field, inputClass, UNKNOWN_MED_NAME } from './ui';
import { ChoiceSelect, NumberField, TextField, type SelectChoice } from './fields';
import { Modal } from './Modal';
import { FormErrorList, ModalFormActions } from './ModalFormFooter';

/** Sentinel key for the medication picker's "not attributed" choice. */
const NO_MEDICATION = '__none__';

type FormValues = Record<string, string>;

function valuesToForm(values: Record<string, EventPropertyValue>): FormValues {
  const out: FormValues = {};
  for (const [k, v] of Object.entries(values)) out[k] = String(v);
  return out;
}

function coerceValues(type: EventType, form: FormValues): Record<string, EventPropertyValue> {
  const out: Record<string, EventPropertyValue> = {};
  for (const prop of type.properties) {
    const raw = form[prop.id];
    if (raw === undefined || raw === '') continue;
    out[prop.id] = prop.type === 'text' ? raw : Number(raw);
  }
  return out;
}

/**
 * Coerces the raw form strings against the selected type and runs the core
 * validator, pulled out of `EventLogger` so the component body only branches
 * once (on `type`) instead of twice — keeps the render function's cyclomatic
 * complexity down without changing behaviour.
 */
function buildEventFormState(type: EventType | undefined, values: FormValues) {
  if (!type) {
    return { coerced: {} as Record<string, EventPropertyValue>, errors: ['Pick an event type.'] };
  }
  const coerced = coerceValues(type, values);
  const errors = validateEventInstanceValues(type, coerced);
  return { coerced, errors };
}

/**
 * Which medications the attribution picker offers: the **active** ones
 * (FR-24.2). An event already attributed to a medication that has since been
 * deactivated keeps that medication in the list, so reopening the event shows
 * the real name instead of silently dropping the attribution — the same
 * active-vs-all split `SlotEditor` makes for its slot items.
 */
function attributionChoices(medications: Medication[], selectedId: string): SelectChoice[] {
  const live = medications.filter((m) => !m.deleted);
  const active = live.filter((m) => m.active);
  const retained =
    selectedId !== '' && !active.some((m) => m.id === selectedId)
      ? live.find((m) => m.id === selectedId)
      : undefined;
  const meds = retained ? [retained, ...active] : active;
  return [
    { id: NO_MEDICATION, name: 'No medication' },
    ...meds.map((m) => ({ id: m.id, name: m.name, color: m.color })),
  ];
}

/** The attribution the logger opens with, when it was opened from a dose row. */
export interface EventAttributionPrefill {
  medId: string;
  /** The `PlannedOccurrence.logEntryId` of the dose this was logged from. */
  doseLogEntryId?: string;
}

export function EventLogger({
  types,
  zone,
  initial,
  prefill,
  title,
  onClose,
}: {
  types: EventType[];
  zone: string;
  initial: EventInstance | null;
  prefill?: EventAttributionPrefill;
  /** Overrides the modal heading, e.g. "Log side effect" from a dose row. */
  title?: string;
  onClose: () => void;
}) {
  const medications = useStore((s) => s.medications);
  const doseLog = useStore((s) => s.doseLog);
  const logEvent = useStore((s) => s.logEvent);
  const updateEventInstance = useStore((s) => s.updateEventInstance);

  const [typeId, setTypeId] = useState<string>(initial?.typeId ?? types[0]?.id ?? '');
  const [when, setWhen] = useState<string>(
    instantToDatetimeLocal(initial?.occurredAt ?? Date.now(), zone),
  );
  const [values, setValues] = useState<FormValues>(initial ? valuesToForm(initial.values) : {});
  const [note, setNote] = useState<string>(initial?.note ?? '');
  const [attribution, setAttribution] = useState<EventAttribution>({
    medId: initial?.medId ?? prefill?.medId,
    doseLogEntryId: initial?.doseLogEntryId ?? prefill?.doseLogEntryId,
  });

  const type = types.find((t) => t.id === typeId);
  const occurredAt = datetimeLocalToInstant(when, zone);
  const { coerced, errors: valueErrors } = buildEventFormState(type, values);
  // Same gate the value validator gets: the core decides, the UI only reports
  // and disables Save. No attribution rule is re-implemented here.
  const errors = [
    ...valueErrors,
    ...validateEventAttribution({ medications, doseLog }, attribution),
  ];
  const canSave = !!type && errors.length === 0;

  const setValue = (propId: string, value: string) => setValues((v) => ({ ...v, [propId]: value }));

  const selectType = (id: string) => {
    setTypeId(id);
    if (!initial) setValues({});
  };

  // Choosing a different medication drops any dose link: the link names one
  // specific logged dose, which belonged to the medication being replaced.
  // Choosing "No medication" clears the attribution entirely.
  const selectMedication = (id: string) =>
    setAttribution((a) =>
      id === NO_MEDICATION ? {} : id === a.medId ? a : { medId: id, doseLogEntryId: undefined },
    );

  const save = () => {
    if (!type || !canSave) return;
    const input: EventInstanceInput = {
      typeId: type.id,
      occurredAt,
      values: coerced,
      note,
      medId: attribution.medId,
      doseLogEntryId: attribution.doseLogEntryId,
    };
    if (initial) updateEventInstance(initial.id, input);
    else logEvent(input);
    onClose();
  };

  const heading = title ?? (initial ? 'Edit event' : 'Log event');

  return (
    <Modal title={heading} onClose={onClose}>
      <Form
        validationBehavior="aria"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-3"
      >
        {types.length === 0 ? (
          <FirstTypePrompt onCreated={setTypeId} />
        ) : (
          <Field label="Type">
            <ChoiceSelect
              aria-label="Event type"
              choices={types.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
              selectedId={typeId}
              isDisabled={!!initial}
              onChange={selectType}
            />
          </Field>
        )}

        <Field label="Time">
          <input
            type="datetime-local"
            className={inputClass}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            aria-label="Time occurred"
          />
        </Field>

        {type?.properties.map((prop) => (
          <ValueInput
            key={prop.id}
            prop={prop}
            value={values[prop.id] ?? ''}
            onChange={(v) => setValue(prop.id, v)}
          />
        ))}

        <Field
          label="Attributed to (optional)"
          hint="The medication you associate this with. SteadyDose records what you state; it does not work out why something happened."
        >
          <ChoiceSelect
            aria-label="Attributed to"
            choices={attributionChoices(medications, attribution.medId ?? '')}
            selectedId={attribution.medId ?? NO_MEDICATION}
            onChange={selectMedication}
          />
        </Field>

        <AttributedDoseNote
          doseLogEntryId={attribution.doseLogEntryId}
          doseLog={doseLog}
          medications={medications}
        />

        <Field label="Note">
          <textarea
            className={inputClass}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Note"
          />
        </Field>

        <FormErrorList errors={errors} />
        <ModalFormActions onCancel={onClose} onSave={save} canSave={canSave} />
      </Form>
    </Modal>
  );
}

/**
 * The no-types-yet state (Stage 24 FR-24.3). "Log side effect" on a dose row is
 * offered to every user, including one who has never opened the Events tab —
 * so the dialog it opens must not be an empty picker with nothing to choose.
 * It creates the first type in place, marked `category: 'side-effect'`, with
 * the same default properties the type editor seeds, and selects it. The user
 * can rename it or add properties later on the Events tab.
 */
function FirstTypePrompt({ onCreated }: { onCreated: (typeId: string) => void }) {
  const addEventType = useStore((s) => s.addEventType);
  const [name, setName] = useState('Side effect');

  const create = () => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const created = addEventType({
      name: trimmed,
      color: '#9333ea',
      properties: DEFAULT_EVENT_PROPERTIES(),
      category: 'side-effect',
    });
    onCreated(created.id);
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-3">
      <p className="text-xs text-slate-400">
        You have no event types yet. Name the one you want to record, and it will be saved as a
        side-effect type you can reuse.
      </p>
      <TextField
        label="Type name"
        aria-label="New event type name"
        value={name}
        onChange={setName}
      />
      <div>
        <Button variant="secondary" onClick={create} disabled={name.trim() === ''}>
          Create type
        </Button>
      </div>
    </div>
  );
}

/**
 * Shows which logged dose the event is attributed to, when it was opened from
 * a dose row. Read-only: the dose link is set by where the user started, never
 * picked from a list, and it is cleared by changing or clearing the medication.
 * Renders nothing when there is no dose link (or it no longer resolves — the
 * error list already reports that case).
 */
function AttributedDoseNote({
  doseLogEntryId,
  doseLog,
  medications,
}: {
  doseLogEntryId: string | undefined;
  doseLog: DoseLogEntry[];
  medications: Medication[];
}) {
  if (doseLogEntryId === undefined) return null;
  const entry = doseLog.find((e) => e.id === doseLogEntryId && !e.deleted);
  if (!entry) return null;
  const medName = medications.find((m) => m.id === entry.medId)?.name ?? UNKNOWN_MED_NAME;
  return (
    <p className="-mt-1 text-xs text-slate-400" data-testid="attributed-dose">
      Attributed to the {medName} dose you logged at{' '}
      {formatDateTimeWithZone(entry.actualInstant, entry.zone)}.
    </p>
  );
}

function ValueInput({
  prop,
  value,
  onChange,
}: {
  prop: EventPropertyDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = `${prop.name || prop.id}${prop.required ? ' *' : ''}`;

  if (prop.type === 'text') {
    return (
      <TextField
        label={label}
        aria-label={prop.name || prop.id}
        value={value}
        onChange={onChange}
      />
    );
  }

  // Scale/number/duration all edit a numeric string through `NumberField`;
  // like the guardrail fields it wraps, min/max are not clamped in the input
  // itself — the core (`validateEventInstanceValues`) is the source of truth
  // for the range/integer checks, surfaced below as the instance's errors.
  const numberValue = value === '' ? undefined : Number(value);
  const onNumberChange = (v: number) => onChange(Number.isNaN(v) ? '' : String(v));

  if (prop.type === 'scale') {
    const [min, max] = scaleRange(prop);
    return (
      <NumberField
        label={`${label} (${min}–${max})`}
        aria-label={prop.name || prop.id}
        value={numberValue}
        onChange={onNumberChange}
      />
    );
  }

  // number + duration are both numeric; duration is entered in seconds.
  return (
    <NumberField
      label={prop.type === 'duration' ? `${label} (seconds)` : label}
      aria-label={prop.name || prop.id}
      value={numberValue}
      onChange={onNumberChange}
    />
  );
}
