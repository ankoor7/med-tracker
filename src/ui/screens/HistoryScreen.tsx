import { useMemo, useState, type ReactNode } from 'react';
import {
  APPOINTMENT_KINDS,
  APPOINTMENT_STATUSES,
  activeStrategy,
  adherenceTimeline,
  appointmentKindLabel,
  appointmentStatusLabel,
  appointmentTiming,
  computeAdherence,
  datetimeLocalToInstant,
  filterLog,
  formatDateTimeWithZone,
  formatTimeWithZone,
  groupChangesByDay,
  instantToDatetimeLocal,
  levelSeriesFor,
  validateAppointment,
  type Appointment,
  type AppointmentKind,
  type AppointmentStatus,
  type DoseLogEntry,
  type HistoryFilter,
  type IanaZone,
  type Medication,
  type RegimenChange,
} from '../../core';
import { useStore, type AppointmentInput } from '../../store/store';
import {
  Button,
  Card,
  ColorDot,
  Field,
  FormErrors,
  inputClass,
  ModalActions,
} from '../components/ui';
import { AccountPanel } from '../components/AccountPanel';
import { RemindersPanel } from '../components/RemindersPanel';
import { AdherenceChart } from '../components/AdherenceChart';
import { BloodLevelChart } from '../components/BloodLevelChart';
import { FieldDiffList } from '../components/ChangeMarkers';
import { OuraPanel } from '../components/OuraPanel';
import { DataTransferPanel } from '../components/DataTransferPanel';
import { Modal } from '../components/Modal';
import { useNow } from '../lib/useNow';

const COMMON_ZONES = [
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

export function HistoryScreen() {
  const now = useNow();
  const slots = useStore((s) => s.slots);
  const medications = useStore((s) => s.medications);
  const doseLog = useStore((s) => s.doseLog);
  const regimenChanges = useStore((s) => s.regimenChanges);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  const [filter, setFilter] = useState<HistoryFilter>({});

  const assumeTakenOnTime = settings.assumeTakenOnTime ?? true;

  const adherence = useMemo(
    () =>
      computeAdherence(
        slots,
        medications,
        doseLog,
        settings.zone,
        settings.adherenceWindowDays,
        settings.missedDayThreshold,
        now,
        assumeTakenOnTime,
      ),
    [slots, medications, doseLog, settings, now, assumeTakenOnTime],
  );

  const timeline = useMemo(
    () =>
      adherenceTimeline(
        slots,
        medications,
        doseLog,
        settings.zone,
        settings.adherenceWindowDays,
        now,
        assumeTakenOnTime,
      ),
    [
      slots,
      medications,
      doseLog,
      settings.zone,
      settings.adherenceWindowDays,
      now,
      assumeTakenOnTime,
    ],
  );

  const entries = useMemo(
    () => filterLog(doseLog, filter, settings.zone),
    [doseLog, filter, settings.zone],
  );

  // Blood-level chart: the app renders only what the extension provides. Pick the
  // filtered med (or the first one) and ask the extension for a series.
  const levelMed = filter.medId ? medById.get(filter.medId) : medications.find((m) => !m.deleted);
  const levelDoses = useMemo(
    () =>
      levelMed
        ? doseLog
            .filter((e) => !e.deleted && e.status === 'taken' && e.medId === levelMed.id)
            .sort((a, b) => a.actualInstant - b.actualInstant)
        : [],
    [doseLog, levelMed],
  );
  const levelSeries =
    levelMed && levelDoses.length > 0
      ? levelSeriesFor(activeStrategy, {
          med: levelMed,
          doses: levelDoses,
          from: levelDoses[0]!.actualInstant,
          to: now,
        })
      : null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">History</h2>

      <AccountPanel />

      {adherence.missedPatternWarning && (
        <div className="rounded-md border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">
          <strong>Missed-pattern warning:</strong> {adherence.missed} timing-sensitive doses missed
          in the last {adherence.windowDays} days (threshold {adherence.threshold}).
        </div>
      )}

      <Card>
        <h3 className="mb-2 text-sm font-medium">
          Adherence — last {adherence.windowDays} days (timing-sensitive only)
        </h3>
        <div className="flex items-baseline gap-4">
          <span className="text-3xl font-semibold text-accent-muted">
            {Math.round(adherence.ratio * 100)}%
          </span>
          <span className="text-xs text-slate-400">
            {adherence.taken} taken · {adherence.missed} missed · {adherence.expected} expected
          </span>
        </div>
        <div className="mt-3">
          <AdherenceChart days={timeline} changes={regimenChanges} zone={settings.zone} />
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-medium">
          Predicted blood level{levelMed ? ` — ${levelMed.name}` : ''}
        </h3>
        {levelSeries ? (
          <BloodLevelChart
            series={levelSeries}
            doseMarkers={levelDoses.map((d) => d.actualInstant)}
            changes={regimenChanges}
            zone={settings.zone}
          />
        ) : (
          <p className="text-sm text-slate-400">
            No predicted curve. SteadyDose computes no pharmacology itself — provide a pharmacology
            extension with a <code>levelSeries</code> function to chart predicted levels here.
          </p>
        )}
      </Card>

      <AppointmentsCard />

      <RegimenChangesCard changes={regimenChanges} zone={settings.zone} />

      <OuraPanel />

      <Card>
        <h3 className="mb-2 text-sm font-medium">Settings</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Time zone">
            <input
              list="zone-list"
              className={inputClass}
              value={settings.zone}
              onChange={(e) => updateSettings({ zone: e.target.value })}
              aria-label="Time zone"
            />
            <datalist id="zone-list">
              {COMMON_ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Field>
          <Field label="Adherence window (days)">
            <input
              type="number"
              min="1"
              className={inputClass}
              value={settings.adherenceWindowDays}
              onChange={(e) =>
                updateSettings({ adherenceWindowDays: Math.max(1, Number(e.target.value)) })
              }
              aria-label="Adherence window days"
            />
          </Field>
          <Field label="Missed threshold">
            <input
              type="number"
              min="0"
              className={inputClass}
              value={settings.missedDayThreshold}
              onChange={(e) =>
                updateSettings({ missedDayThreshold: Math.max(0, Number(e.target.value)) })
              }
              aria-label="Missed threshold"
            />
          </Field>
        </div>
        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent-muted"
            checked={assumeTakenOnTime}
            onChange={(e) => updateSettings({ assumeTakenOnTime: e.target.checked })}
            aria-label="Assume doses taken on time"
          />
          <span className="text-sm">
            Assume doses taken on time
            <span className="mt-0.5 block text-xs text-slate-500">
              Past scheduled doses count as taken on time unless you log or edit them. Turn off to
              mark untaken doses as missed/due and track real gaps.
            </span>
          </span>
        </label>
        <p className="mt-3 text-xs text-slate-500">
          Current zone: {formatTimeWithZone(now, settings.zone)}
        </p>
      </Card>

      <RemindersPanel />

      <DataTransferPanel />

      <Card>
        <h3 className="mb-2 text-sm font-medium">Dose log</h3>
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Medication">
            <select
              className={inputClass}
              value={filter.medId ?? ''}
              onChange={(e) => setFilter((f) => ({ ...f, medId: e.target.value || undefined }))}
              aria-label="Filter by medication"
            >
              <option value="">All</option>
              {medications
                .filter((m) => !m.deleted)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="From">
            <input
              type="date"
              className={inputClass}
              value={filter.from ?? ''}
              onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value || undefined }))}
              aria-label="From date"
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={inputClass}
              value={filter.to ?? ''}
              onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value || undefined }))}
              aria-label="To date"
            />
          </Field>
        </div>
        {entries.length === 0 && (
          <p className="text-sm text-slate-400">No doses match the current filter.</p>
        )}
        <ul className="flex flex-col divide-y divide-slate-800">
          {entries.map((entry) => (
            <LogRow key={entry.id} entry={entry} med={medById.get(entry.medId)} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function LogRow({ entry, med: m }: { entry: DoseLogEntry; med: Medication | undefined }) {
  const late = entry.actualInstant > entry.scheduledInstant + 60_000;
  const overCap = entry.warnings.length > 0;
  return (
    <li className="flex items-start justify-between gap-2 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <ColorDot color={m?.color ?? '#64748b'} />
          <span className="text-sm font-medium">{m?.name ?? entry.medId}</span>
          <span className="text-xs text-slate-400">
            {entry.dose}
            {entry.unit}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">
          {formatDateTimeWithZone(entry.actualInstant, entry.zone)}
          {' · scheduled '}
          {formatTimeWithZone(entry.scheduledInstant, entry.zone)}
        </p>
        {overCap && <p className="text-xs text-red-300">⚠ {entry.warnings.join(' ')}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {entry.adjusted && <Tag className="border-amber-700 text-amber-300">adjusted</Tag>}
        {late && <Tag className="border-slate-600 text-slate-300">late</Tag>}
        {overCap && <Tag className="border-red-700 text-red-300">over-cap</Tag>}
      </div>
    </li>
  );
}

function Tag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${className}`}>{children}</span>;
}

// Reverse-chronological list of derived regimen changes (Stage 16), grouped by
// day, with each change's field diffs. A change can be annotated with a note or
// soft-deleted (its marker then disappears from the charts).
function RegimenChangesCard({ changes, zone }: { changes: RegimenChange[]; zone: IanaZone }) {
  const groups = useMemo(
    // groupChangesByDay sorts ascending; reverse for newest-first display.
    () => groupChangesByDay(changes, zone).slice().reverse(),
    [changes, zone],
  );

  return (
    <Card>
      <h3 className="mb-2 text-sm font-medium">Regimen changes</h3>
      {groups.length === 0 ? (
        <p className="text-sm text-slate-400">
          No regimen changes yet. Editing a medication or schedule records a dated change here and a
          marker on the charts above.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <li key={group.date}>
              <p className="mb-1 text-xs font-medium text-slate-400">{group.date}</p>
              <ul className="flex flex-col gap-2">
                {group.changes.map((c) => (
                  <ChangeRow key={c.id} change={c} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ChangeRow({ change }: { change: RegimenChange }) {
  const addChangeNote = useStore((s) => s.addChangeNote);
  const deleteChange = useStore((s) => s.deleteChange);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(change.note ?? '');

  return (
    <li className="rounded-md border border-slate-800 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">{change.summary}</p>
          <FieldDiffList changes={change.changes} />
          {change.note && !editing && (
            <p className="mt-1 text-xs italic text-slate-400">“{change.note}”</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-300 focus:outline-none focus:text-slate-200"
            onClick={() => setEditing((v) => !v)}
            aria-label={change.note ? 'Edit note' : 'Add note'}
          >
            {change.note ? 'Edit note' : 'Add note'}
          </button>
          <button
            type="button"
            className="text-xs text-red-400 hover:text-red-300 focus:outline-none focus:text-red-200"
            onClick={() => deleteChange(change.id)}
            aria-label="Delete change"
          >
            Delete
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-2 flex items-end gap-2">
          <Field label="Note">
            <input
              className={inputClass}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Change note"
            />
          </Field>
          <Button
            variant="secondary"
            onClick={() => {
              addChangeNote(change.id, draft.trim());
              setEditing(false);
            }}
          >
            Save
          </Button>
        </div>
      )}
    </li>
  );
}

// ---- Appointments & tests (Stage 20) -----------------------------------------
// Upcoming and past medical appointments/tests, split by derived timing, with a
// free-text notes field for what happened. Records only — no dose value, no
// scheduling/adherence impact (PRD NFR-Safety).
function AppointmentsCard() {
  const now = useNow();
  const appointments = useStore((s) => s.appointments);
  const settings = useStore((s) => s.settings);
  const deleteAppointment = useStore((s) => s.deleteAppointment);
  const [editing, setEditing] = useState<Appointment | 'new' | null>(null);

  const { upcoming, past } = useMemo(() => {
    const live = appointments.filter((a) => !a.deleted);
    return {
      upcoming: live
        .filter((a) => appointmentTiming(a.scheduledAt, now) === 'upcoming')
        .sort((a, b) => a.scheduledAt - b.scheduledAt),
      past: live
        .filter((a) => appointmentTiming(a.scheduledAt, now) === 'past')
        .sort((a, b) => b.scheduledAt - a.scheduledAt),
    };
  }, [appointments, now]);

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">Appointments &amp; tests</h3>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          New
        </Button>
      </div>

      {upcoming.length === 0 && past.length === 0 ? (
        <p className="text-sm text-slate-400">
          No appointments yet. Add a doctor's appointment or test, then record what happened.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <AppointmentList
            title="Upcoming"
            appts={upcoming}
            empty="Nothing upcoming."
            onEdit={setEditing}
            onDelete={deleteAppointment}
          />
          <AppointmentList
            title="Past"
            appts={past}
            empty="No past appointments."
            onEdit={setEditing}
            onDelete={deleteAppointment}
          />
        </div>
      )}

      {editing && (
        <AppointmentEditor
          zone={settings.zone}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function AppointmentList({
  title,
  appts,
  empty,
  onEdit,
  onDelete,
}: {
  title: string;
  appts: Appointment[];
  empty: string;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-400">{title}</p>
      {appts.length === 0 ? (
        <p className="text-xs text-slate-500">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-800">
          {appts.map((a) => (
            <AppointmentRow key={a.id} appt={a} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AppointmentRow({
  appt,
  onEdit,
  onDelete,
}: {
  appt: Appointment;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
}) {
  const cancelled = appt.status === 'cancelled';
  return (
    <li className="flex items-start justify-between gap-2 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Tag className="border-slate-600 text-slate-300">{appointmentKindLabel(appt.kind)}</Tag>
          <span className={`text-sm font-medium ${cancelled ? 'text-slate-500 line-through' : ''}`}>
            {appt.title}
          </span>
          {appt.status !== 'scheduled' && (
            <Tag
              className={
                appt.status === 'completed'
                  ? 'border-emerald-700 text-emerald-300'
                  : 'border-slate-600 text-slate-400'
              }
            >
              {appointmentStatusLabel(appt.status)}
            </Tag>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-400">
          {formatDateTimeWithZone(appt.scheduledAt, appt.zone)}
          {appt.provider ? ` · ${appt.provider}` : ''}
          {appt.location ? ` · ${appt.location}` : ''}
        </p>
        {appt.notes && <p className="mt-0.5 text-xs text-slate-300">{appt.notes}</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button variant="secondary" onClick={() => onEdit(appt)}>
          Edit
        </Button>
        <Button variant="ghost" onClick={() => onDelete(appt.id)}>
          Delete
        </Button>
      </div>
    </li>
  );
}

// Stage 20 form modal; revisit (extract fields / add a unit test) when next touched.
// fallow-ignore-next-line complexity
function AppointmentEditor({
  zone,
  initial,
  onClose,
}: {
  zone: string;
  initial: Appointment | null;
  onClose: () => void;
}) {
  const addAppointment = useStore((s) => s.addAppointment);
  const updateAppointment = useStore((s) => s.updateAppointment);

  const [kind, setKind] = useState<AppointmentKind>(initial?.kind ?? 'appointment');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [when, setWhen] = useState(
    instantToDatetimeLocal(initial?.scheduledAt ?? Date.now(), zone),
  );
  const [status, setStatus] = useState<AppointmentStatus>(initial?.status ?? 'scheduled');
  const [provider, setProvider] = useState(initial?.provider ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const scheduledAt = datetimeLocalToInstant(when, zone);
  const errors = validateAppointment({ kind, title, scheduledAt, status });
  const canSave = errors.length === 0;

  const save = () => {
    if (!canSave) return;
    const input: AppointmentInput = {
      kind,
      title: title.trim(),
      scheduledAt,
      status,
      provider: provider.trim() || undefined,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    if (initial) updateAppointment(initial.id, input);
    else addAppointment(input);
    onClose();
  };

  return (
    <Modal title={initial ? 'Edit appointment' : 'New appointment'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Kind">
          <select
            className={inputClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as AppointmentKind)}
            aria-label="Kind"
          >
            {APPOINTMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {appointmentKindLabel(k)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Title"
            placeholder="e.g. Neurology review"
          />
        </Field>

        <Field label="Date & time">
          <input
            type="datetime-local"
            className={inputClass}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            aria-label="Date and time"
          />
        </Field>

        <Field label="Status">
          <select
            className={inputClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
            aria-label="Status"
          >
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {appointmentStatusLabel(s)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Provider">
          <input
            className={inputClass}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="Provider"
            placeholder="Clinician / clinic"
          />
        </Field>

        <Field label="Location">
          <input
            className={inputClass}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            aria-label="Location"
          />
        </Field>

        <Field label="Notes — what happened">
          <textarea
            className={inputClass}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Notes"
          />
        </Field>

        <FormErrors errors={errors} />

        <ModalActions onCancel={onClose} onSave={save} canSave={canSave} />
      </div>
    </Modal>
  );
}
