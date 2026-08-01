// Stage 20 Unit 4: migrated onto the Stage 19/Unit 3 React Aria form
// primitives. Name/notes-adjacent text and numeric fields now use the shared
// `TextField`/`NumberField` (`../components/fields`) with accessible
// `FieldError`s; the property-type and event-type pickers are now a themed
// `Select` (the same `Select`/`Popover`/`ListBox` pattern `SlotEditor` uses
// for its medication picker) instead of a hand-rolled `<select>`. The date +
// colour inputs stay native `<input type="date"|"color">` in a `Field`,
// matching the precedent set by `StartDateField`/`MedicationEditor` — there is
// no React Aria date-input primitive in `fields.tsx` yet. Store actions
// (`addEventType`/`updateEventType`/`logEvent`/`updateEventInstance`/
// `deleteEventInstance`/`setEventTypeArchived`) are unchanged.

import { useMemo, useState } from 'react';
import { Form } from 'react-aria-components';
import {
  DEFAULT_EVENT_PROPERTIES,
  EVENT_PROPERTY_TYPES,
  formatDateTimeWithZone,
  newId,
  newPropertyDef,
  scaleRange,
  summarizeInstance,
  validateEventTypeShape,
  type EventCategory,
  type EventInstance,
  type EventPropertyDef,
  type EventPropertyType,
  type EventType,
} from '../../core';
import { useStore, type EventTypeInput } from '../../store/store';
import { Button, Card, ColorDot, Field, inputClass } from '../components/ui';
import { ChoiceSelect, NumberField, TextField } from '../components/fields';
import { EventLogger } from '../components/EventLogger';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormErrorList, ModalFormActions } from '../components/ModalFormFooter';

const BLANK_TYPE = (): EventTypeInput => ({
  name: '',
  color: '#9333ea',
  properties: DEFAULT_EVENT_PROPERTIES(),
  notes: '',
});

// FR-24.1: what an event type records. `category` is optional and absent means
// general/flare — every pre-Stage-24 type reads that way — so the editor shows
// 'flare' as the resolved default but only writes a value once the user picks
// one, leaving an untouched type byte-identical on save.
const CATEGORY_CHOICES: { id: EventCategory; name: string }[] = [
  { id: 'flare', name: 'General / flare-up' },
  { id: 'side-effect', name: 'Side effect' },
];

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
          category: initial.category,
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
      <Form
        validationBehavior="aria"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-3"
      >
        <TextField
          label="Name"
          aria-label="Event type name"
          value={form.name}
          onChange={(name) => setForm({ ...form, name })}
        />

        <Field label="Colour">
          <input
            type="color"
            className="h-9 w-16 rounded border border-slate-700 bg-slate-950"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            aria-label="Colour"
          />
        </Field>

        <Field
          label="Kind"
          hint="Side-effect types are the ones offered when you log a side effect from a dose."
        >
          <ChoiceSelect
            aria-label="Event kind"
            choices={CATEGORY_CHOICES}
            selectedId={form.category ?? 'flare'}
            onChange={(category) => setForm({ ...form, category: category as EventCategory })}
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

        <FormErrorList errors={errors} />
        <ModalFormActions onCancel={onClose} onSave={save} canSave={canSave} />
      </Form>
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
        <TextField
          label="Property name"
          aria-label="Property name"
          value={prop.name}
          onChange={(name) => onChange({ name })}
        />
        <Field label="Type">
          <PropertyTypeSelect
            value={prop.type}
            onChange={(t) => onChange(typeReset(t))}
            ariaLabel="Property type"
          />
        </Field>
      </div>

      {prop.type === 'scale' && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Min"
            aria-label="Scale min"
            value={min}
            onChange={(v) => onChange({ min: v })}
          />
          <NumberField
            label="Max"
            aria-label="Scale max"
            value={max}
            onChange={(v) => onChange({ max: v })}
          />
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

/** The property-type picker: a themed React Aria `Select` over the fixed vocabulary. */
function PropertyTypeSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: EventPropertyType;
  onChange: (type: EventPropertyType) => void;
  ariaLabel: string;
}) {
  return (
    <ChoiceSelect
      aria-label={ariaLabel}
      choices={EVENT_PROPERTY_TYPES.map((t) => ({ id: t, name: t }))}
      selectedId={value}
      onChange={(id) => onChange(id as EventPropertyType)}
    />
  );
}
