import { useMemo, useState } from 'react';
import {
  formatTimeWithZone,
  isoDateInZone,
  plannedSlotsAsOf,
  type Medication,
  type PlannedOccurrence,
} from '../../core';
import { useStore } from '../../store/store';
import { Button, Card, ColorDot, Ring, Stat } from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';
import { DoseLogger, type LoggerTarget } from '../components/DoseLogger';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useNow } from '../lib/useNow';
import { useScheduleData } from '../lib/useScheduleData';

// A genuinely-logged (not merely assumed) occurrence can be edited or deleted
// in place (Stage 18 FR-18.2) — the fix belongs on the screen where the
// mistake is noticed.
interface DeleteTarget {
  id: string;
  medName: string;
}

export function TodayScreen() {
  const now = useNow();
  const { zone, assumeTakenOnTime, medications, doseLog, doseOverrides, regimen } =
    useScheduleData();
  const takeGroup = useStore((s) => s.takeGroup);
  const deleteLogEntry = useStore((s) => s.deleteLogEntry);

  const [target, setTarget] = useState<LoggerTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const today = isoDateInZone(now, zone);
  const planned = useMemo(
    () =>
      // Resolved rather than raw: Today always renders the current day, but
      // routing it through the same path keeps every screen on one rule and
      // makes it correct by construction if it ever renders another date.
      plannedSlotsAsOf(regimen, today, doseLog, zone, now, doseOverrides, assumeTakenOnTime),
    [today, regimen, doseLog, zone, now, doseOverrides, assumeTakenOnTime],
  );
  const medById = new Map(medications.map((m) => [m.id, m]));

  const occurrences = planned.flatMap((s) => s.occurrences);
  const total = occurrences.length;
  const taken = occurrences.filter((o) => o.status === 'taken').length;
  const missed = occurrences.filter((o) => o.status === 'missed').length;
  const skipped = occurrences.filter((o) => o.status === 'skipped').length;
  // Skipped occurrences are resolved (Stage 18 FR-18.3) — not still "remaining"
  // for the user to act on, and not folded into "taken" either.
  const remaining = total - taken - skipped;
  const pct = total > 0 ? taken / total : 0;
  const ringColor = total > 0 && taken === total ? '#4ade80' : '#2cb1a6';

  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: zone,
  }).format(now);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Today</h2>
        <span className="text-xs text-slate-400">{dateLabel}</span>
      </div>

      {total > 0 && (
        <Card className="flex flex-col items-center gap-5 py-7">
          <Ring value={pct} color={ringColor} aria-label={`${taken} of ${total} doses taken today`}>
            <span className="text-4xl font-semibold tabular-nums text-slate-50">
              {taken}
              <span className="text-2xl text-slate-500">/{total}</span>
            </span>
            <span className="mt-1 text-xs uppercase tracking-wide text-slate-400">doses taken</span>
          </Ring>
          <div className="flex items-center gap-8">
            <Stat value={remaining} label="Remaining" />
            {missed > 0 && <Stat value={missed} label="Missed" />}
            {skipped > 0 && <Stat value={skipped} label="Skipped" />}
          </div>
        </Card>
      )}

      {planned.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">
            No doses scheduled. Add time-slots on the Schedule tab.
          </p>
        </Card>
      )}

      {planned.map((slot) => {
        const remaining = slot.occurrences.filter(
          (o) => o.status !== 'taken' && o.status !== 'skipped',
        );
        return (
          <Card key={slot.slotId}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <span className="text-base font-semibold">
                  {formatTimeWithZone(slot.scheduledInstant, zone)}
                </span>
                {slot.label && <span className="ml-2 text-sm text-slate-400">{slot.label}</span>}
              </div>
              {remaining.length > 0 && (
                <Button
                  variant="primary"
                  onClick={() => takeGroup(slot.slotId, slot.scheduledInstant)}
                >
                  Take group ({remaining.length})
                </Button>
              )}
            </div>

            <ul className="flex flex-col divide-y divide-slate-800">
              {slot.occurrences.map((occ) => (
                <OccurrenceRow
                  key={occ.medId}
                  occ={occ}
                  med={medById.get(occ.medId)}
                  onLog={() =>
                    setTarget({
                      slotId: occ.slotId,
                      medId: occ.medId,
                      scheduledInstant: occ.scheduledInstant,
                      normalDose: occ.dose,
                      // A genuinely-taken occurrence (not merely assumed) edits its
                      // real log entry rather than creating a new one.
                      entryId: occ.status === 'taken' && !occ.assumed ? occ.logEntryId : undefined,
                    })
                  }
                  onSkip={() =>
                    setTarget({
                      slotId: occ.slotId,
                      medId: occ.medId,
                      scheduledInstant: occ.scheduledInstant,
                      normalDose: occ.dose,
                      startInSkipMode: true,
                    })
                  }
                  onDelete={() =>
                    setDeleteTarget({
                      id: occ.logEntryId!,
                      medName: medById.get(occ.medId)?.name ?? occ.medId,
                    })
                  }
                />
              ))}
            </ul>
          </Card>
        );
      })}

      {target && <DoseLogger target={target} onClose={() => setTarget(null)} />}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this logged dose?"
          confirmLabel="Delete dose"
          body={
            <p>
              This removes the logged {deleteTarget.medName} dose. It will stop counting toward
              adherence and the occurrence will show as not yet taken.
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

function OccurrenceRow({
  occ,
  med,
  onLog,
  onSkip,
  onDelete,
}: {
  occ: PlannedOccurrence;
  med: Medication | undefined;
  onLog: () => void;
  onSkip: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <ColorDot color={med?.color ?? '#64748b'} />
        <span className="truncate text-sm">{med?.name ?? occ.medId}</span>
        <span className="text-xs text-slate-400">
          {occ.dose}
          {med?.unit ?? ''}
        </span>
        {occ.overridden && (
          <span
            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
            title="One-time adjusted dose"
          >
            adjusted
          </span>
        )}
      </div>
      <OccurrenceActions occ={occ} onLog={onLog} onSkip={onSkip} onDelete={onDelete} />
    </li>
  );
}

// Anything not-yet-taken (or only assumed-taken) offers "Log"/"Edit" to record
// it, plus "Skip" while it's still unresolved (Stage 18 FR-18.3). A genuinely
// logged dose (a real entry, not the assume-on-time fill-in) — taken OR skipped
// — is deletable, the correction path a mistake is actually noticed from
// (Stage 18 FR-18.2). A skipped entry has no dose amount to edit, so it is not
// offered an "Edit" affordance; delete it and re-log if the outcome was wrong.
// Each of Log/Edit/Skip/Delete has its own visibility condition (status ×
// assumed × genuinely-logged); covered by TodayScreen.test.tsx.
//
// `isGenuinelyLogged`/`isUnresolved` are extracted (rather than inlined here)
// to keep this component's own branching flat — each is a plain status
// predicate with no rendering concern of its own.
function isGenuinelyLogged(occ: PlannedOccurrence): boolean {
  return (
    (occ.status === 'taken' || occ.status === 'skipped') && !occ.assumed && occ.logEntryId != null
  );
}

function isUnresolved(occ: PlannedOccurrence): boolean {
  return occ.status === 'upcoming' || occ.status === 'due' || occ.status === 'missed';
}

function OccurrenceActions({
  occ,
  onLog,
  onSkip,
  onDelete,
}: {
  occ: PlannedOccurrence;
  onLog: () => void;
  onSkip: () => void;
  onDelete: () => void;
}) {
  const isSkipped = occ.status === 'skipped';
  const genuinelyLogged = isGenuinelyLogged(occ);
  const unresolved = isUnresolved(occ);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <StatusBadge status={occ.status} assumed={occ.assumed} />
      {!isSkipped && (
        <Button variant="secondary" onClick={onLog}>
          {occ.status !== 'taken' ? 'Log' : 'Edit'}
        </Button>
      )}
      {unresolved && (
        <Button variant="ghost" className="text-slate-400 hover:bg-slate-700/40" onClick={onSkip}>
          Skip
        </Button>
      )}
      {genuinelyLogged && (
        <Button
          variant="ghost"
          className="text-status-missed hover:bg-status-missed/10"
          onClick={onDelete}
        >
          Delete
        </Button>
      )}
    </div>
  );
}
