import { useMemo, useState } from 'react';
import {
  activeStrategy,
  checkGuardrails,
  datetimeLocalToInstant,
  formatTimeWithZone,
  instantToDatetimeLocal,
  type Instant,
} from '../../core';
import { useStore } from '../../store/store';
import { Button, Field, inputClass } from './ui';
import { Modal } from './Modal';

export interface LoggerTarget {
  slotId: string;
  medId: string;
  scheduledInstant: Instant;
  normalDose: number;
}

export function DoseLogger({ target, onClose }: { target: LoggerTarget; onClose: () => void }) {
  const medications = useStore((s) => s.medications);
  const doseLog = useStore((s) => s.doseLog);
  const zone = useStore((s) => s.settings.zone);
  const logDose = useStore((s) => s.logDose);

  const med = medications.find((m) => m.id === target.medId);
  const now = useMemo(() => Date.now(), []);

  const [doseStr, setDoseStr] = useState(String(target.normalDose));
  const [whenStr, setWhenStr] = useState(() => instantToDatetimeLocal(now, zone));
  const [confirmed, setConfirmed] = useState(false);

  const dose = Number(doseStr);
  const actualInstant = datetimeLocalToInstant(whenStr, zone);

  // Optional pharmacology extension suggestion (no-op default → null).
  const suggestion = useMemo(() => {
    if (!med) return null;
    const recentDoses = doseLog.filter(
      (e) => !e.deleted && e.status === 'taken' && e.medId === med.id,
    );
    return activeStrategy.computeAdjustment({
      med,
      scheduledInstant: target.scheduledInstant,
      actualInstant,
      recentDoses,
    });
  }, [med, target.scheduledInstant, actualInstant, doseLog]);

  if (!med) return null;

  const validDose = Number.isFinite(dose) && dose > 0;
  const warnings = validDose ? checkGuardrails(med, dose, actualInstant, doseLog, zone) : [];
  const overCap = warnings.length > 0;
  const isAdjusted = dose !== target.normalDose;
  const canLog = validDose && (!overCap || confirmed);

  const submit = () => {
    if (!canLog) return;
    logDose({
      slotId: target.slotId,
      medId: target.medId,
      scheduledInstant: target.scheduledInstant,
      dose,
      actualInstant,
    });
    onClose();
  };

  return (
    <Modal title={`Log ${med.name}`} onClose={onClose}>
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
            className={inputClass}
            value={whenStr}
            onChange={(e) => {
              setWhenStr(e.target.value);
              setConfirmed(false);
            }}
            aria-label="Time taken"
          />
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

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={overCap ? 'danger' : 'primary'} disabled={!canLog} onClick={submit}>
            {overCap ? 'Log over-cap dose' : 'Log dose'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
