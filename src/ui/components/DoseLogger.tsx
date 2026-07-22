import { useMemo, useState, type ReactNode } from 'react';
import {
  activeStrategy,
  checkGuardrails,
  datetimeLocalToInstant,
  describeOffset,
  formatTimeWithZone,
  instantToDatetimeLocal,
  MINUTE_MS,
  nextOccurrenceForMed,
  roundInstantToStep,
  type Instant,
} from '../../core';
import { useStore } from '../../store/store';
import { useScheduleData } from '../lib/useScheduleData';
import { Button, Field, inputClass } from './ui';
import { Modal } from './Modal';

export interface LoggerTarget {
  slotId: string;
  medId: string;
  scheduledInstant: Instant;
  normalDose: number;
  /**
   * Optional pre-filled "time taken" (e.g. dragged on the day calendar, Stage
   * 13). Clamped to ≤ now. Defaults to now-rounded-to-5-min when absent.
   */
  actualInstant?: Instant;
  /**
   * When set, this modal edits the already-logged entry with this id (Stage 18
   * FR-18.2 — Today/History correction paths) instead of creating a new one.
   * Its stored dose/time seed the form; guardrails are re-run excluding this
   * entry so an edit never counts against itself.
   */
  entryId?: string;
  /**
   * Open directly in "mark as skipped" mode (Stage 18 FR-18.3) — the Today
   * screen's quick "Skip" action. Only meaningful for a fresh log (no
   * `entryId`); ignored otherwise.
   */
  startInSkipMode?: boolean;
}

export function DoseLogger({ target, onClose }: { target: LoggerTarget; onClose: () => void }) {
  const { medications, slots, doseLog, zone } = useScheduleData();
  const logDose = useStore((s) => s.logDose);
  const editLogEntry = useStore((s) => s.editLogEntry);
  const setDoseOverride = useStore((s) => s.setDoseOverride);
  const skipDose = useStore((s) => s.skipDose);

  const med = medications.find((m) => m.id === target.medId);
  const editingEntry = target.entryId
    ? doseLog.find((e) => e.id === target.entryId && !e.deleted)
    : undefined;
  // "Now", rounded to the 5-minute step so the common path needs no adjustment.
  const now = useMemo(() => roundInstantToStep(Date.now()), []);

  // A dose can be marked skipped instead of taken (Stage 18 FR-18.3) — but only
  // when creating a fresh entry. An existing logged entry (taken or skipped) is
  // corrected through `editLogEntry`/delete, not converted between the two: a
  // skip has no meaningful dose amount, so letting the dose editor above also
  // rewrite `status` would let an edit silently turn a skip into a partial,
  // dose-bearing "taken" record (or vice versa) without the guardrail/adherence
  // paths ever re-deriving from a clean state.
  const canSkip = !target.entryId;
  const [skipMode, setSkipMode] = useState(canSkip && (target.startInSkipMode ?? false));
  const [skipReason, setSkipReason] = useState('');

  const [doseStr, setDoseStr] = useState(
    String(editingEntry ? editingEntry.dose : target.normalDose),
  );
  // Seed "time taken" from the entry being edited, else a dragged calendar
  // time when given (clamped to ≤ now), else the rounded "now" default.
  const [whenStr, setWhenStr] = useState(() =>
    instantToDatetimeLocal(
      editingEntry ? editingEntry.actualInstant : Math.min(target.actualInstant ?? now, now),
      zone,
    ),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [adjustNext, setAdjustNext] = useState(false);
  const [nextDoseStr, setNextDoseStr] = useState('');
  const [nextConfirmed, setNextConfirmed] = useState(false);

  const dose = Number(doseStr);
  const actualInstant = datetimeLocalToInstant(whenStr, zone);
  // Excludes the entry being edited from its own guardrail history — matches
  // `editLogEntry`'s server-side recheck so the preview shown here agrees with
  // what actually gets saved.
  const guardrailLog = target.entryId ? doseLog.filter((e) => e.id !== target.entryId) : doseLog;

  // The next scheduled occurrence of this med (Stage 12 — adjust next dose).
  const nextOcc = useMemo(
    () => nextOccurrenceForMed(target.medId, target.scheduledInstant, slots, medications, zone),
    [target.medId, target.scheduledInstant, slots, medications, zone],
  );

  // Quick presets for the "time taken" control (Stage 11 FR-11.2). Relative
  // nudges count back from the current value and never produce a future time.
  const setWhen = (instant: Instant) => {
    setWhenStr(instantToDatetimeLocal(Math.min(instant, now), zone));
    setConfirmed(false);
  };
  const nudge = (deltaMin: number) => setWhen(actualInstant + deltaMin * MINUTE_MS);
  const offsetLabel = describeOffset(actualInstant, target.scheduledInstant);

  // Optional pharmacology extension suggestion (no-op default → null).
  const suggestion = useMemo(() => {
    if (!med) return null;
    const recentDoses = guardrailLog.filter(
      (e) => !e.deleted && e.status === 'taken' && e.medId === med.id,
    );
    return activeStrategy.computeAdjustment({
      med,
      scheduledInstant: target.scheduledInstant,
      actualInstant,
      recentDoses,
    });
  }, [med, target.scheduledInstant, actualInstant, guardrailLog]);

  if (!med) return null;

  const validDose = Number.isFinite(dose) && dose > 0;
  const warnings = validDose ? checkGuardrails(med, dose, actualInstant, guardrailLog, zone) : [];
  const overCap = warnings.length > 0;
  const isAdjusted = dose !== target.normalDose;
  const isLate = actualInstant > target.scheduledInstant + MINUTE_MS;
  // Offer the next-dose adjustment when this dose was changed or taken late
  // (Stage 12 FR-12.1) and there's an upcoming occurrence to adjust. Not
  // offered while editing a past entry (Stage 18 FR-18.2) — that's a
  // correction of what already happened, not a cue to plan the next dose.
  const offerAdjustNext = !target.entryId && (isAdjusted || isLate) && nextOcc != null;

  const nextDose = Number(nextDoseStr);
  const validNextDose = Number.isFinite(nextDose) && nextDose > 0;
  const nextWarnings =
    adjustNext && validNextDose && nextOcc
      ? checkGuardrails(med, nextDose, nextOcc.scheduledInstant, guardrailLog, zone)
      : [];
  const nextOverCap = nextWarnings.length > 0;
  const canSetNext = !adjustNext || (validNextDose && (!nextOverCap || nextConfirmed));

  const canLog = validDose && (!overCap || confirmed) && canSetNext;

  // Default the next-dose field to the amount just entered for this dose.
  const toggleAdjustNext = (on: boolean) => {
    setAdjustNext(on);
    if (on && nextDoseStr === '') setNextDoseStr(doseStr);
    setNextConfirmed(false);
  };

  const submit = () => {
    if (!canLog) return;
    if (target.entryId) {
      editLogEntry(target.entryId, { dose, actualInstant });
    } else {
      logDose({
        slotId: target.slotId,
        medId: target.medId,
        scheduledInstant: target.scheduledInstant,
        dose,
        actualInstant,
      });
    }
    if (adjustNext && nextOcc && validNextDose) {
      setDoseOverride({
        slotId: nextOcc.slotId,
        medId: target.medId,
        scheduledInstant: nextOcc.scheduledInstant,
        dose: nextDose,
      });
    }
    onClose();
  };

  const submitSkip = () => {
    skipDose({
      slotId: target.slotId,
      medId: target.medId,
      scheduledInstant: target.scheduledInstant,
      actualInstant: Date.now(),
      reason: skipReason.trim() || undefined,
    });
    onClose();
  };

  if (skipMode) {
    return (
      <Modal title={`Skip ${med.name}?`} onClose={onClose}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-slate-400">
            Scheduled for {formatTimeWithZone(target.scheduledInstant, zone)}. Recorded distinctly
            from a missed dose — it won't count against adherence.
          </p>
          <Field label="Reason (optional)">
            <input
              className={inputClass}
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              placeholder="e.g. clinician advised skipping"
              aria-label="Skip reason"
            />
          </Field>
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSkipMode(false)}>
              Back
            </Button>
            <Button variant="secondary" onClick={submitSkip}>
              Mark skipped
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={target.entryId ? `Edit ${med.name} dose` : `Log ${med.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-400">
          Scheduled for {formatTimeWithZone(target.scheduledInstant, zone)}. Normal dose{' '}
          {target.normalDose}
          {med.unit}.
        </p>

        <Field label={`Dose (${med.unit})`}>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className={inputClass}
            value={doseStr}
            onChange={(e) => {
              setDoseStr(e.target.value);
              setConfirmed(false);
            }}
            aria-label="Dose"
          />
        </Field>

        <Field label="Time taken">
          <input
            type="datetime-local"
            step={300}
            className={inputClass}
            value={whenStr}
            onChange={(e) => {
              setWhenStr(e.target.value);
              setConfirmed(false);
            }}
            aria-label="Time taken"
          />
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <PresetButton onClick={() => setWhen(now)}>Now</PresetButton>
            <PresetButton onClick={() => setWhen(target.scheduledInstant)}>Scheduled</PresetButton>
            <PresetButton onClick={() => nudge(-15)}>−15m</PresetButton>
            <PresetButton onClick={() => nudge(-30)}>−30m</PresetButton>
            <PresetButton onClick={() => nudge(-60)}>−1h</PresetButton>
            <span
              className={`ml-auto text-xs ${
                offsetLabel === 'on time' ? 'text-slate-400' : 'text-amber-400'
              }`}
            >
              {offsetLabel}
            </span>
          </div>
        </Field>

        {suggestion && (
          <button
            type="button"
            onClick={() => {
              setDoseStr(String(suggestion.suggestedDose));
              setConfirmed(false);
            }}
            className="rounded-md border border-accent/60 bg-accent/10 px-3 py-2 text-left text-sm text-accent-muted hover:bg-accent/20"
          >
            Use suggested {suggestion.suggestedDose}
            {med.unit}
            {suggestion.rationale ? ` — ${suggestion.rationale}` : ''}
          </button>
        )}

        {isAdjusted && !overCap && (
          <p className="text-xs text-amber-400">
            This differs from the normal dose — it will be recorded as an adjusted dose.
          </p>
        )}

        {overCap && (
          <div className="rounded-md border border-red-700 bg-red-950/50 p-3 text-sm">
            <p className="font-medium text-red-300">Guardrail warning</p>
            <ul className="mt-1 list-disc pl-5 text-red-200">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <label className="mt-2 flex items-center gap-2 text-red-200">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I understand and want to log this dose anyway.
            </label>
          </div>
        )}

        {offerAdjustNext && nextOcc && (
          <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={adjustNext}
                onChange={(e) => toggleAdjustNext(e.target.checked)}
              />
              <span>
                Adjust next {med.name} dose
                <span className="block text-xs text-slate-400">
                  Next: {formatTimeWithZone(nextOcc.scheduledInstant, zone)} · normally{' '}
                  {nextOcc.dose}
                  {med.unit}
                </span>
              </span>
            </label>

            {adjustNext && (
              <div className="mt-3 flex flex-col gap-2">
                <Field label={`Next dose (${med.unit})`}>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    className={inputClass}
                    value={nextDoseStr}
                    onChange={(e) => {
                      setNextDoseStr(e.target.value);
                      setNextConfirmed(false);
                    }}
                    aria-label="Next dose"
                  />
                </Field>
                {nextOverCap && (
                  <div className="rounded-md border border-red-700 bg-red-950/50 p-2 text-xs">
                    <ul className="list-disc pl-5 text-red-200">
                      {nextWarnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                    <label className="mt-2 flex items-center gap-2 text-red-200">
                      <input
                        type="checkbox"
                        checked={nextConfirmed}
                        onChange={(e) => setNextConfirmed(e.target.checked)}
                      />
                      Set this over-cap next dose anyway.
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-1 flex items-center justify-between gap-2">
          {canSkip ? (
            <button
              type="button"
              onClick={() => setSkipMode(true)}
              className="text-xs text-slate-500 hover:text-slate-300 focus:outline-none focus:text-slate-200"
            >
              Mark as skipped instead
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant={overCap ? 'danger' : 'primary'} disabled={!canLog} onClick={submit}>
              {target.entryId
                ? overCap
                  ? 'Save over-cap dose'
                  : 'Save changes'
                : overCap
                  ? 'Log over-cap dose'
                  : 'Log dose'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PresetButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-accent-muted hover:text-slate-100"
    >
      {children}
    </button>
  );
}
