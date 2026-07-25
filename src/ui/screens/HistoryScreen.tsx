import { useMemo, useState, type ReactNode } from 'react';
import { Meter } from 'react-aria-components';
import {
  adherenceTimeline,
  classifyGuardrailBreach,
  computeAdherence,
  DEFAULT_ON_TIME_WINDOW_MINUTES,
  filterLog,
  formatDateTimeWithZone,
  formatTimeWithZone,
  groupChangesByDay,
  type AdherenceResult,
  type DoseLogEntry,
  type HistoryFilter,
  type IanaZone,
  type Medication,
  type RegimenChange,
} from '../../core';
import { useStore } from '../../store/store';
import { Button, Card, ColorDot, Field, inputClass, UNKNOWN_MED_NAME } from '../components/ui';
import { AccountPanel } from '../components/AccountPanel';
import { RemindersPanel } from '../components/RemindersPanel';
import { AdherenceChart } from '../components/AdherenceChart';
import { FieldDiffList } from '../components/ChangeMarkers';
import { OuraPanel } from '../components/OuraPanel';
import { DataTransferPanel } from '../components/DataTransferPanel';
import { DoseLogger, type LoggerTarget } from '../components/DoseLogger';
import { ConfirmDialog } from '../components/ConfirmDialog';
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
  const scheduleSnapshots = useStore((s) => s.scheduleSnapshots);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  const [filter, setFilter] = useState<HistoryFilter>({});
  // Correction paths for an already-logged dose (Stage 18 FR-18.2): edit its
  // time/amount (re-runs guardrails) or delete it (confirmed — see LogRow).
  const [editTarget, setEditTarget] = useState<LoggerTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DoseLogEntry | null>(null);
  const deleteLogEntry = useStore((s) => s.deleteLogEntry);

  const assumeTakenOnTime = settings.assumeTakenOnTime ?? true;
  const onTimeWindowMinutes = settings.onTimeWindowMinutes ?? DEFAULT_ON_TIME_WINDOW_MINUTES;

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
        scheduleSnapshots,
        onTimeWindowMinutes,
      ),
    [
      slots,
      medications,
      doseLog,
      settings,
      now,
      assumeTakenOnTime,
      scheduleSnapshots,
      onTimeWindowMinutes,
    ],
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
        scheduleSnapshots,
        onTimeWindowMinutes,
      ),
    [
      slots,
      medications,
      doseLog,
      settings.zone,
      settings.adherenceWindowDays,
      now,
      assumeTakenOnTime,
      scheduleSnapshots,
      onTimeWindowMinutes,
    ],
  );

  const entries = useMemo(
    () => filterLog(doseLog, filter, settings.zone),
    [doseLog, filter, settings.zone],
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">History</h2>

      <AccountPanel />

      {adherence.missedPatternWarning && (
        <div
          role="alert"
          className="rounded-md border border-status-missed/30 bg-status-missed/10 p-3 text-sm text-status-missed"
        >
          <strong>Missed-pattern warning:</strong> {adherence.missed} timing-sensitive doses missed
          in the last {adherence.windowDays} days (threshold {adherence.threshold}).
        </div>
      )}

      <Card>
        <h3 className="mb-2 text-sm font-medium">
          Adherence — last {adherence.windowDays} days (timing-sensitive only)
        </h3>
        <div className="flex items-start gap-4">
          {/* Stage 21: a React Aria Meter for the headline figure — the track
              gives a glanceable proportion alongside the number, and its
              accessible name (below) carries the same FR-18.6 assumed-basis
              caveat the visible note does, so a screen-reader user gets it too. */}
          <Meter
            value={Math.round(adherence.ratio * 100)}
            aria-label={adherenceMeterLabel(adherence)}
            className="flex w-28 shrink-0 flex-col gap-1.5"
          >
            {({ percentage, valueText }) => (
              <>
                <span className="text-3xl font-semibold tabular-nums text-accent-muted">
                  {valueText}
                </span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/70">
                  <div
                    className="h-full rounded-full bg-accent-muted"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </>
            )}
          </Meter>
          <span className="text-xs text-slate-400" data-testid="adherence-counts">
            {adherence.onTime} on time
            {adherence.assumedOnTime > 0 && (
              <span className="text-slate-500"> ({adherence.assumedOnTime} assumed)</span>
            )}
            {' · '}
            {adherence.late} late · {adherence.missed} missed · {adherence.expected} expected
            {adherence.skipped > 0 && ` · ${adherence.skipped} skipped (not counted)`}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          "On time" means within {adherence.onTimeWindowMinutes} minutes of the scheduled time — see
          the on-time window setting below. A skipped dose doesn't count toward this figure either
          way.
        </p>
        {adherence.assumedOnTime > 0 && (
          // Stage 18 FR-18.6: this figure is partly the assume-on-time policy's
          // fill-in, not a full record of what actually happened — disclosed here
          // next to the number, not only in Settings below. Calm and factual,
          // matching the on-time-window copy's precedent: state the mechanism,
          // not an alarm.
          <p className="mt-1 text-xs text-slate-500" data-testid="assumed-basis-note">
            <strong className="font-medium text-slate-400">Basis:</strong> {adherence.assumedOnTime}{' '}
            of the {adherence.onTime} on-time doses above are assumed from your schedule because
            they were never logged or edited — not confirmed by you. Turn off "Assume doses taken on
            time" below to see them as missed instead.
          </p>
        )}
        <div className="mt-3">
          <AdherenceChart days={timeline} changes={regimenChanges} zone={settings.zone} />
        </div>
      </Card>

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
        <div className="mt-4">
          <Field label="On-time window (minutes)">
            <input
              type="number"
              min="1"
              className={inputClass}
              value={onTimeWindowMinutes}
              onChange={(e) =>
                updateSettings({ onTimeWindowMinutes: Math.max(1, Number(e.target.value)) })
              }
              aria-label="On-time window minutes"
            />
          </Field>
          <p className="mt-1 text-xs text-slate-500">
            How close to the scheduled time a timing-sensitive dose has to be logged to count as "on
            time" rather than "late" — one setting, applied to every medication. It doesn't change
            what was logged, only how the same history is summarised: changing it recalculates the
            figures above from your existing dose log, nothing is added or removed.
          </p>
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
              Past scheduled doses count as taken on time unless you log or edit them, so a fresh
              install or a quiet week doesn't read as a wall of missed doses. Assumed doses are
              always shown distinctly from ones you actually logged (Today, Calendar and the figures
              above). Turning this off recalculates the figures above from your existing dose log —
              nothing is added or removed — but every unlogged past dose will now show as missed
              instead of assumed; turning it back on restores the same assumption again.
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
            <LogRow
              key={entry.id}
              entry={entry}
              med={medById.get(entry.medId)}
              onEdit={() =>
                setEditTarget({
                  slotId: entry.slotId,
                  medId: entry.medId,
                  scheduledInstant: entry.scheduledInstant,
                  // Current slot dose, if the slot/item still exists — used only
                  // to flag "adjusted" against; the entry's own dose seeds the form.
                  normalDose:
                    slots
                      .find((s) => s.id === entry.slotId)
                      ?.items.find((i) => i.medId === entry.medId)?.dose ?? entry.dose,
                  entryId: entry.id,
                })
              }
              onDelete={() => setDeleteTarget(entry)}
            />
          ))}
        </ul>
      </Card>

      {editTarget && <DoseLogger target={editTarget} onClose={() => setEditTarget(null)} />}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this logged dose?"
          confirmLabel="Delete dose"
          body={
            <p>
              This removes the {medById.get(deleteTarget.medId)?.name ?? UNKNOWN_MED_NAME} dose
              logged at {formatDateTimeWithZone(deleteTarget.actualInstant, deleteTarget.zone)}. It
              will stop counting toward adherence.
            </p>
          }
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            deleteLogEntry(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

// Accessible name for the headline adherence Meter (Stage 21 FR-21.3): a
// screen-reader user gets the same assumed-basis caveat the visible "Basis"
// note discloses to a sighted user, not just the bare percentage — mirrors
// TodayScreen's `ringAriaLabel` for the same FR-18.6 distinction.
function adherenceMeterLabel(adherence: AdherenceResult): string {
  const pct = Math.round(adherence.ratio * 100);
  return adherence.assumedOnTime > 0
    ? `${pct}% on time over the last ${adherence.windowDays} days, including ${adherence.assumedOnTime} assumed on time and not logged`
    : `${pct}% on time over the last ${adherence.windowDays} days`;
}

// Branches on taken/skipped/late/adjusted/over-cap to render one dose-log row
// (Stage 18 FR-18.2/18.3); each branch is exercised by HistoryScreen.test.tsx,
// splitting further would just move the same conditions into more, smaller,
// harder-to-follow functions.
function LogRow({
  entry,
  med: m,
  onEdit,
  onDelete,
}: {
  entry: DoseLogEntry;
  med: Medication | undefined;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const skipped = entry.status === 'skipped';
  // "Late" is a lateness-of-taking concept — doesn't apply to a dose that was
  // never taken (Stage 18 FR-18.3).
  const late = !skipped && entry.actualInstant > entry.scheduledInstant + 60_000;
  const overCap = entry.warnings.length > 0;
  return (
    <li className="flex items-start justify-between gap-2 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <ColorDot color={m?.color ?? '#64748b'} />
          <span className="text-sm font-medium">{m?.name ?? UNKNOWN_MED_NAME}</span>
          <span className="text-xs text-slate-400">
            {skipped ? 'Skipped' : `${entry.dose}${entry.unit}`}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">
          {formatDateTimeWithZone(entry.actualInstant, entry.zone)}
          {' · scheduled '}
          {formatTimeWithZone(entry.scheduledInstant, entry.zone)}
        </p>
        <LogRowNote entry={entry} skipped={skipped} overCap={overCap} />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <LogRowTags entry={entry} skipped={skipped} late={late} overCap={overCap} />
        <div className="flex gap-1">
          {/* A skip has no dose amount to correct — delete and re-log instead
              of offering a dose editor that doesn't apply to it. */}
          {!skipped && (
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-status-missed hover:bg-status-missed/10"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
}

// Extracted from `LogRow` to keep its own branching flat — pure tag rendering,
// no behaviour.
// Extracted from `LogRow` to keep its own branching flat — a skip's optional
// reason and a taken dose's over-cap warning are mutually exclusive, one-line
// notes, never both.
function LogRowNote({
  entry,
  skipped,
  overCap,
}: {
  entry: DoseLogEntry;
  skipped: boolean;
  overCap: boolean;
}) {
  if (skipped && entry.skipReason) {
    return <p className="mt-0.5 text-xs italic text-slate-400">“{entry.skipReason}”</p>;
  }
  if (!skipped && overCap) {
    return <p className="text-xs text-status-missed">⚠ {entry.warnings.join(' ')}</p>;
  }
  return null;
}

// Stage 18 FR-18.10: this tag used to hardcode "over-cap" for any warning,
// which misnamed a min-interval ("too soon") breach — the same leak the
// acknowledgement button copy had, just at a different site.
function breachTagLabel(kind: ReturnType<typeof classifyGuardrailBreach>): string {
  if (kind === 'over-cap') return 'over-cap';
  if (kind === 'too-soon') return 'too-soon';
  return 'guardrail';
}

function LogRowTags({
  entry,
  skipped,
  late,
  overCap,
}: {
  entry: DoseLogEntry;
  skipped: boolean;
  late: boolean;
  overCap: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {skipped && <Tag className="border-slate-500 text-slate-300">skipped</Tag>}
      {!skipped && entry.adjusted && (
        <Tag className="border-status-due/40 text-status-due">adjusted</Tag>
      )}
      {late && <Tag className="border-slate-600 text-slate-300">late</Tag>}
      {!skipped && overCap && (
        <Tag className="border-status-missed/40 text-status-missed">
          {breachTagLabel(classifyGuardrailBreach(entry.warnings))}
        </Tag>
      )}
    </div>
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
            className="text-xs text-status-missed hover:text-status-missed/80 focus:outline-none focus:text-status-missed"
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
