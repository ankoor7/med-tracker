import { useMemo, useState } from 'react';
import {
  formatTimeWithZone,
  isoDateInZone,
  plannedSlotsAsOf,
  sideEffectTypeOptions,
  type Medication,
  type PlannedOccurrence,
} from '../../core';
import { useStore } from '../../store/store';
import { Button, Card, ColorDot, Ring, Stat, UNKNOWN_MED_NAME } from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';
import { DoseLogger, type LoggerTarget } from '../components/DoseLogger';
import { EventLogger, type EventAttributionPrefill } from '../components/EventLogger';
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
  const eventTypes = useStore((s) => s.eventTypes);

  const [target, setTarget] = useState<LoggerTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  // Stage 24 FR-24.3: the attribution a "Log side effect" action starts the
  // event logger from. Non-null while that dialog is open.
  const [sideEffectFor, setSideEffectFor] = useState<EventAttributionPrefill | null>(null);

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
  // Stage 18 FR-18.6: of `taken`, how many are the assume-on-time policy's
  // fill-in rather than something the user actually logged. The headline ring
  // and count MUST NOT present these as indistinguishable from a real log — a
  // fresh install with zero real entries must not read as "5 of 5 doses
  // taken" with nothing to disclose that every one of them is an assumption.
  const assumedTaken = occurrences.filter((o) => o.status === 'taken' && o.assumed).length;
  // Skipped occurrences are resolved (Stage 18 FR-18.3) — not still "remaining"
  // for the user to act on, and not folded into "taken" either.
  const remaining = total - taken - skipped;
  const pct = total > 0 ? taken / total : 0;
  // Stage 20: theme tokens (status-taken / accent), not hardcoded hex — so the
  // ring stays correct in both light and dark instead of a fixed swatch.
  const ringColor =
    total > 0 && taken === total ? 'rgb(var(--sd-status-taken-rgb))' : 'rgb(var(--sd-accent-rgb))';

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
        <TodaySummaryCard
          total={total}
          taken={taken}
          missed={missed}
          skipped={skipped}
          assumedTaken={assumedTaken}
          remaining={remaining}
          pct={pct}
          ringColor={ringColor}
        />
      )}

      {planned.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">No doses scheduled. Add times on the Meds tab.</p>
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
                      medName: medById.get(occ.medId)?.name ?? UNKNOWN_MED_NAME,
                    })
                  }
                  onLogSideEffect={() =>
                    setSideEffectFor({ medId: occ.medId, doseLogEntryId: occ.logEntryId })
                  }
                />
              ))}
            </ul>
          </Card>
        );
      })}

      {target && <DoseLogger target={target} onClose={() => setTarget(null)} />}

      {sideEffectFor && (
        <EventLogger
          title="Log side effect"
          types={sideEffectTypeOptions(eventTypes)}
          zone={zone}
          initial={null}
          prefill={sideEffectFor}
          onClose={() => setSideEffectFor(null)}
        />
      )}

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

// The ring + composition disclosure + stat row (Stage 18 FR-18.6). Extracted
// from `TodayScreen` to keep its own branching flat — this is purely
// presentational, its inputs are the already-computed occurrence counts.
function TodaySummaryCard({
  total,
  taken,
  missed,
  skipped,
  assumedTaken,
  remaining,
  pct,
  ringColor,
}: {
  total: number;
  taken: number;
  missed: number;
  skipped: number;
  assumedTaken: number;
  remaining: number;
  pct: number;
  ringColor: string;
}) {
  return (
    <Card className="flex flex-col items-center gap-5 py-7">
      <Ring value={pct} color={ringColor} aria-label={ringAriaLabel(taken, total, assumedTaken)}>
        <span className="text-4xl font-semibold tabular-nums text-slate-50">
          {taken}
          <span className="text-2xl text-slate-500">/{total}</span>
        </span>
        <span className="mt-1 text-xs uppercase tracking-wide text-slate-400">doses taken</span>
      </Ring>
      {/* Stage 18 FR-18.6: disclosed here, next to the headline number, not
          only in History → Settings. Text label (not colour alone) so the
          caveat survives a glance and greyscale/colour-blind rendering. A
          day with zero assumed doses renders no caveat at all. */}
      {assumedTaken > 0 && (
        <p className="-mt-3 text-xs text-slate-400" data-testid="assumed-composition-note">
          <span aria-hidden>◇</span> {assumedTaken} of {taken} assumed taken on time, not logged —{' '}
          {taken - assumedTaken} confirmed by you.
        </p>
      )}
      <div className="flex items-center gap-8">
        <Stat value={remaining} label="Remaining" />
        {missed > 0 && <Stat value={missed} label="Missed" />}
        {skipped > 0 && <Stat value={skipped} label="Skipped" />}
        {assumedTaken > 0 && <Stat value={assumedTaken} label="Assumed" />}
      </div>
    </Card>
  );
}

// Accessible name for the ring: discloses the assumed share inline so a
// screen-reader user gets the same caveat a sighted user sees in the note
// below the ring. Extracted purely to keep `TodaySummaryCard` flat.
function ringAriaLabel(taken: number, total: number, assumedTaken: number): string {
  return assumedTaken > 0
    ? `${taken} of ${total} doses taken today, including ${assumedTaken} assumed on time and not logged`
    : `${taken} of ${total} doses taken today`;
}

function OccurrenceRow({
  occ,
  med,
  onLog,
  onSkip,
  onDelete,
  onLogSideEffect,
}: {
  occ: PlannedOccurrence;
  med: Medication | undefined;
  onLog: () => void;
  onSkip: () => void;
  onDelete: () => void;
  onLogSideEffect: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <ColorDot color={med?.color ?? '#64748b'} />
        <span className="truncate text-sm">{med?.name ?? UNKNOWN_MED_NAME}</span>
        <span className="text-xs text-slate-400">
          {occ.dose}
          {med?.unit ?? ''}
        </span>
        {occ.overridden && (
          <span
            className="rounded bg-status-due/15 px-1.5 py-0.5 text-[10px] font-medium text-status-due"
            title="One-time adjusted dose"
          >
            adjusted
          </span>
        )}
      </div>
      <OccurrenceActions
        occ={occ}
        onLog={onLog}
        onSkip={onSkip}
        onDelete={onDelete}
        onLogSideEffect={onLogSideEffect}
      />
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

// Stage 24 FR-24.3: a side effect can be attributed to a dose the user
// actually took and actually logged — so this needs a real entry to point
// `doseLogEntryId` at, and the assume-taken-on-time fill-in has none. A
// *skipped* entry is excluded too: the dose was never taken, so there is
// nothing about it for the user to report an effect of.
function canAttributeSideEffect(occ: PlannedOccurrence): boolean {
  return occ.status === 'taken' && isGenuinelyLogged(occ);
}

function OccurrenceActions({
  occ,
  onLog,
  onSkip,
  onDelete,
  onLogSideEffect,
}: {
  occ: PlannedOccurrence;
  onLog: () => void;
  onSkip: () => void;
  onDelete: () => void;
  onLogSideEffect: () => void;
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
        <Button
          variant="ghost"
          className="text-slate-400 data-[hovered]:bg-slate-700/40"
          onClick={onSkip}
        >
          Skip
        </Button>
      )}
      {canAttributeSideEffect(occ) && (
        <Button
          variant="ghost"
          className="text-slate-400 data-[hovered]:bg-slate-700/40"
          onClick={onLogSideEffect}
        >
          Log side effect
        </Button>
      )}
      {genuinelyLogged && (
        <Button
          variant="ghost"
          className="text-status-missed data-[hovered]:bg-status-missed/10"
          onClick={onDelete}
        >
          Delete
        </Button>
      )}
    </div>
  );
}
