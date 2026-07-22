import { useMemo, useState } from 'react';
import {
  DEFAULT_EVENT_PROPERTIES,
  EVENT_PROPERTY_TYPES,
  datetimeLocalToInstant,
  formatDateTimeWithZone,
  instantToDatetimeLocal,
  newId,
  newPropertyDef,
  scaleRange,
  summarizeInstance,
  validateEventInstanceValues,
  validateEventTypeShape,
  type EventInstance,
  type EventPropertyDef,
  type EventPropertyType,
  type EventPropertyValue,
  type EventType,
} from '../../core';
import { useStore, type EventInstanceInput, type EventTypeInput } from '../../store/store';
import { Button, Card, ColorDot, Field, inputClass } from '../components/ui';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';

const BLANK_TYPE = (): EventTypeInput => ({
  name: '',
  color: '#9333ea',
  properties: DEFAULT_EVENT_PROPERTIES(),
  notes: '',
});

export function EventsScreen() {
  const eventTypes = useStore((s) => s.eventTypes);
  const eventInstances = useStore((s) => s.eventInstances);
  const settings = useStore((s) => s.settings);
  const setEventTypeArchived = useStore((s) => s.setEventTypeArchived);
  const deleteEventInstance = useStore((s) => s.deleteEventInstance);

  const [editingType, setEditingType] = useState<EventType | 'new' | null>(null);
  const [logging, setLogging] = useState<EventInstance | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<EventInstance | null>(null);

  const types = eventTypes.filter((t) => !t.deleted && !t.archived);
  const archivedTypes = eventTypes.filter((t) => !t.deleted && t.archived);
  const typeById = useMemo(() => new Map(eventTypes.map((t) => [t.id, t])), [eventTypes]);

  const history = useMemo(
    () => eventInstances.filter((e) => !e.deleted).sort((a, b) => b.occurredAt - a.occurredAt),
    [eventInstances],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Events</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditingType('new')}>
            New type
          </Button>
          <Button onClick={() => setLogging('new')} disabled={types.length === 0}>
            Log event
          </Button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Track occurrences of your condition (e.g. seizures). Define your own event types with custom
        properties, then log when they happen. SteadyDose never originates an event — you record it.
      </p>

      {/* Event types */}
      <Card>
        <h3 className="mb-2 text-sm font-medium">Event types</h3>
        {types.length === 0 ? (
          <p className="text-sm text-slate-400">
            No event types yet. Create one to start logging events.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-800">
            {types.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ColorDot color={t.color} />
                    <span className="font-medium">{t.name}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {t.properties.length === 0
                      ? 'No properties'
                      : t.properties.map((p) => p.name || p.id).join(' · ')}
                  </p>
                  {t.notes && <p className="mt-0.5 text-xs text-slate-500">{t.notes}</p>}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button variant="secondary" onClick={() => setEditingType(t)}>
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={() => setEventTypeArchived(t.id, true)}>
                    Archive
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Archived types */}
      {archivedTypes.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-medium">Archived types</h3>
          <ul className="flex flex-col divide-y divide-slate-800">
            {archivedTypes.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <div className="flex items-center gap-2">
                  <ColorDot color={t.color} />
                  <span className="font-medium text-slate-400">{t.name}</span>
                </div>
                <Button variant="secondary" onClick={() => setEventTypeArchived(t.id, false)}>
                  Unarchive
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* History */}
      <Card>
        <h3 className="mb-2 text-sm font-medium">Logged events</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">No events logged yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-800">
            {history.map((e) => {
              const type = typeById.get(e.typeId);
              return (
                <li key={e.id} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ColorDot color={type?.color ?? '#64748b'} />
                      <span className="text-sm font-medium">{type?.name ?? 'Unknown type'}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {formatDateTimeWithZone(e.occurredAt, e.zone)}
                    </p>
                    {type && summarizeInstance(type, e) && (
                      <p className="mt-0.5 text-xs text-slate-300">{summarizeInstance(type, e)}</p>
                    )}
                    {e.note && <p className="mt-0.5 text-xs text-slate-500">{e.note}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {type && (
                      <Button variant="secondary" onClick={() => setLogging(e)}>
                        Edit
                      </Button>
                    )}
                    <Button variant="danger" onClick={() => setConfirmDelete(e)}>
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editingType && (
        <TypeEditor
          initial={editingType === 'new' ? null : editingType}
          onClose={() => setEditingType(null)}
        />
      )}
      {logging && (
        <EventLogger
          types={types}
          zone={settings.zone}
          initial={logging === 'new' ? null : logging}
          onClose={() => setLogging(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this event?"
          confirmLabel="Delete event"
          body={
            <p>
              This removes the {typeById.get(confirmDelete.typeId)?.name ?? 'event'} logged at{' '}
              {formatDateTimeWithZone(confirmDelete.occurredAt, confirmDelete.zone)} from your
              records. There's no way to restore it from within the app.
            </p>
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            deleteEventInstance(confirmDelete.id);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

// ---- Type editor -------------------------------------------------------------

function TypeEditor({ initial, onClose }: { initial: EventType | null; onClose: () => void }) {
  const addEventType = useStore((s) => s.addEventType);
  const updateEventType = useStore((s) => s.updateEventType);

  const [form, setForm] = useState<EventTypeInput>(
    initial
      ? {
          name: initial.name,
          color: initial.color,
          properties: initial.properties.map((p) => ({ ...p })),
          notes: initial.notes ?? '',
        }
      : BLANK_TYPE(),
  );

  const errors = validateEventTypeShape(form);
  const canSave = errors.length === 0;

  const setProp = (index: number, patch: Partial<EventPropertyDef>) =>
    setForm((f) => ({
      ...f,
      properties: f.properties.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));

  const addProp = () =>
    setForm((f) => ({ ...f, properties: [...f.properties, newPropertyDef(newId(), 'number')] }));

  const removeProp = (index: number) =>
    setForm((f) => ({ ...f, properties: f.properties.filter((_, i) => i !== index) }));

  const save = () => {
    if (!canSave) return;
    if (initial) updateEventType(initial.id, form);
    else addEventType(form);
    onClose();
  };

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New event type'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            aria-label="Event type name"
          />
        </Field>

        <Field label="Colour">
          <input
            type="color"
            className="h-9 w-16 rounded border border-slate-700 bg-slate-950"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            aria-label="Colour"
          />
        </Field>

        <fieldset className="flex flex-col gap-3 rounded-md border border-slate-800 p-3">
          <legend className="px-1 text-xs text-slate-400">Properties</legend>
          {form.properties.length === 0 && (
            <p className="text-xs text-slate-500">No properties — add one below.</p>
          )}
          {form.properties.map((prop, i) => (
            <PropertyRow
              key={prop.id || i}
              prop={prop}
              onChange={(patch) => setProp(i, patch)}
              onRemove={() => removeProp(i)}
            />
          ))}
          <div>
            <Button variant="secondary" onClick={addProp}>
              Add property
            </Button>
          </div>
        </fieldset>

        <Field label="Notes">
          <textarea
            className={inputClass}
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            aria-label="Notes"
          />
        </Field>

        {errors.length > 0 && (
          <ul className="text-xs text-red-300">
            {errors.map((msg) => (
              <li key={msg}>⚠ {msg}</li>
            ))}
          </ul>
        )}

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

function PropertyRow({
  prop,
  onChange,
  onRemove,
}: {
  prop: EventPropertyDef;
  onChange: (patch: Partial<EventPropertyDef>) => void;
  onRemove: () => void;
}) {
  const [min, max] = scaleRange(prop);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-800 p-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Property name">
          <input
            className={inputClass}
            value={prop.name}
            onChange={(e) => onChange({ name: e.target.value })}
            aria-label="Property name"
          />
        </Field>
        <Field label="Type">
          <select
            className={inputClass}
            value={prop.type}
            onChange={(e) => onChange(typeReset(e.target.value as EventPropertyType))}
            aria-label="Property type"
          >
            {EVENT_PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {prop.type === 'scale' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min">
            <input
              type="number"
              className={inputClass}
              value={min}
              onChange={(e) => onChange({ min: Number(e.target.value) })}
              aria-label="Scale min"
            />
          </Field>
          <Field label="Max">
            <input
              type="number"
              className={inputClass}
              value={max}
              onChange={(e) => onChange({ max: Number(e.target.value) })}
              aria-label="Scale max"
            />
          </Field>
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={prop.required ?? false}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Required
        </label>
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

// When the property type changes, reset kind-specific fields so a scale always
// carries a range and other kinds don't keep a stale one.
function typeReset(type: EventPropertyType): Partial<EventPropertyDef> {
  if (type === 'scale') return { type, min: 1, max: 5 };
  return { type, min: undefined, max: undefined };
}

// ---- Event logger ------------------------------------------------------------

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

function EventLogger({
  types,
  zone,
  initial,
  onClose,
}: {
  types: EventType[];
  zone: string;
  initial: EventInstance | null;
  onClose: () => void;
}) {
  const logEvent = useStore((s) => s.logEvent);
  const updateEventInstance = useStore((s) => s.updateEventInstance);

  const [typeId, setTypeId] = useState<string>(initial?.typeId ?? types[0]?.id ?? '');
  const [when, setWhen] = useState<string>(
    instantToDatetimeLocal(initial?.occurredAt ?? Date.now(), zone),
  );
  const [values, setValues] = useState<FormValues>(initial ? valuesToForm(initial.values) : {});
  const [note, setNote] = useState<string>(initial?.note ?? '');

  const type = types.find((t) => t.id === typeId);
  const occurredAt = datetimeLocalToInstant(when, zone);
  const coerced = type ? coerceValues(type, values) : {};
  const errors = type ? validateEventInstanceValues(type, coerced) : ['Pick an event type.'];
  const canSave = !!type && errors.length === 0;

  const setValue = (propId: string, value: string) => setValues((v) => ({ ...v, [propId]: value }));

  const save = () => {
    if (!type || !canSave) return;
    const input: EventInstanceInput = { typeId: type.id, occurredAt, values: coerced, note };
    if (initial) updateEventInstance(initial.id, input);
    else logEvent(input);
    onClose();
  };

  return (
    <Modal title={initial ? 'Edit event' : 'Log event'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Type">
          <select
            className={inputClass}
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              if (!initial) setValues({});
            }}
            aria-label="Event type"
            disabled={!!initial}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>

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

        <Field label="Note">
          <textarea
            className={inputClass}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Note"
          />
        </Field>

        {errors.length > 0 && (
          <ul className="text-xs text-red-300">
            {errors.map((msg) => (
              <li key={msg}>⚠ {msg}</li>
            ))}
          </ul>
        )}

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
      <Field label={label}>
        <input
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={prop.name || prop.id}
        />
      </Field>
    );
  }

  if (prop.type === 'scale') {
    const [min, max] = scaleRange(prop);
    return (
      <Field label={`${label} (${min}–${max})`}>
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={prop.name || prop.id}
        />
      </Field>
    );
  }

  // number + duration are both numeric; duration is entered in seconds.
  return (
    <Field label={prop.type === 'duration' ? `${label} (seconds)` : label}>
      <input
        type="number"
        min={prop.type === 'duration' ? 0 : undefined}
        step="any"
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={prop.name || prop.id}
      />
    </Field>
  );
}
