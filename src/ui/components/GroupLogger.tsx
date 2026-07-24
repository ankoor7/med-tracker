// Group dose logger (Stage 13 follow-up). When a whole slot-group is missed and
// the user catches up on the day calendar, they log every medication in the
// group at one shared "time taken" while adjusting each amount individually —
// or excluding some meds entirely. Single-med occurrences keep using the richer
// `DoseLogger` (with its adjust-next flow); this modal handles the ≥2 case.
//
// Safety invariant is preserved: the app never originates a dose value. Each
// amount is pre-filled from the scheduled/overridden dose and re-validated
// against the shared `checkGuardrails` before it can be logged.

import { useMemo, useState } from 'react';
import {
  MINUTE_MS,
  checkGuardrails,
  classifyGuardrailBreach,
  datetimeLocalToInstant,
  describeOffset,
  formatTimeWithZone,
  instantToDatetimeLocal,
  roundInstantToStep,
  type Instant,
} from '../../core';
import { useStore } from '../../store/store';
import { Button, ColorDot, Field, inputClass, UNKNOWN_MED_NAME } from './ui';
import { Modal } from './Modal';
import { TimeTakenField } from './TimeTakenField';

export interface GroupLoggerMember {
  medId: string;
  /** Scheduled (or one-time-overridden) amount; the pre-filled default. */
  normalDose: number;
}

export interface GroupLoggerTarget {
  slotId: string;
  scheduledInstant: Instant;
  label?: string;
  members: GroupLoggerMember[];
  /** Optional pre-filled time taken (e.g. dragged on the calendar). ≤ now. */
  actualInstant?: Instant;
}

interface Row {
  include: boolean;
  doseStr: string;
  confirmed: boolean;
}

export function GroupLogger({
  target,
  onClose,
}: {
  target: GroupLoggerTarget;
  onClose: () => void;
}) {
  const medications = useStore((s) => s.medications);
  const doseLog = useStore((s) => s.doseLog);
  const zone = useStore((s) => s.settings.zone);
  const logDose = useStore((s) => s.logDose);

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);
  const now = useMemo(() => roundInstantToStep(Date.now()), []);

  const requestedInstant = target.actualInstant ?? now;
  const [whenStr, setWhenStr] = useState(() =>
    instantToDatetimeLocal(Math.min(requestedInstant, now), zone),
  );
  // Stage 18 FR-18.9(b)/AC9: a dragged or typed time in the future is never
  // silently swapped for "now" — it's clamped AND explained. Seeded true when
  // the incoming (e.g. dragged-on-the-calendar) time was already future.
  const [futureClamped, setFutureClamped] = useState(requestedInstant > now);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      target.members.map((m) => [
        m.medId,
        { include: true, doseStr: String(m.normalDose), confirmed: false },
      ]),
    ),
  );

  const actualInstant = datetimeLocalToInstant(whenStr, zone);
  const offsetLabel = describeOffset(actualInstant, target.scheduledInstant);

  const setWhen = (instant: Instant) => {
    setFutureClamped(instant > now);
    setWhenStr(instantToDatetimeLocal(Math.min(instant, now), zone));
    // A changed time can flip a guardrail (per-day caps), so re-confirm.
    setRows((prev) =>
      Object.fromEntries(Object.entries(prev).map(([k, r]) => [k, { ...r, confirmed: false }])),
    );
  };
  const nudge = (deltaMin: number) => setWhen(actualInstant + deltaMin * MINUTE_MS);

  const patchRow = (medId: string, patch: Partial<Row>) =>
    setRows((prev) => ({ ...prev, [medId]: { ...prev[medId]!, ...patch } }));

  // Per-med validation against the shared guardrails at the chosen time.
  const evaluated = target.members.map((m) => {
    const row = rows[m.medId]!;
    const med = medById.get(m.medId);
    const dose = Number(row.doseStr);
    const validDose = Number.isFinite(dose) && dose > 0;
    const warnings =
      row.include && validDose && med
        ? checkGuardrails(med, dose, actualInstant, doseLog, zone)
        : [];
    const overCap = warnings.length > 0;
    return { member: m, med, row, dose, validDose, warnings, overCap };
  });

  const included = evaluated.filter((e) => e.row.include);
  const canLog =
    included.length > 0 && included.every((e) => e.validDose && (!e.overCap || e.row.confirmed));
  const anyOverCap = included.some((e) => e.overCap);
  // Breach-kind-aware group button copy (Stage 18 FR-18.10): a min-interval
  // breach must not read "over-cap". Mixed breach kinds across members fall
  // back to a safe generic rather than naming the wrong one.
  const groupBreachKind = classifyGuardrailBreach(included.flatMap((e) => e.warnings));

  const submit = () => {
    if (!canLog) return;
    for (const e of included) {
      logDose({
        slotId: target.slotId,
        medId: e.member.medId,
        scheduledInstant: target.scheduledInstant,
        dose: e.dose,
        actualInstant,
      });
    }
    onClose();
  };

  return (
    <Modal title={`Log ${target.label ?? 'group'}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-400">
          Scheduled for {formatTimeWithZone(target.scheduledInstant, zone)}. Set one time for the
          whole group and adjust each amount below.
        </p>

        <TimeTakenField
          whenStr={whenStr}
          zone={zone}
          now={now}
          scheduledInstant={target.scheduledInstant}
          offsetLabel={offsetLabel}
          futureClamped={futureClamped}
          onSetWhen={setWhen}
          onNudge={nudge}
        />

        <div className="flex flex-col divide-y divide-slate-800 rounded-md border border-slate-800">
          {evaluated.map(({ member, med, row, dose, overCap, warnings }) => (
            <div key={member.medId} className="flex flex-col gap-2 p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.include}
                  onChange={(e) => patchRow(member.medId, { include: e.target.checked })}
                  aria-label={`Include ${med?.name ?? UNKNOWN_MED_NAME}`}
                />
                <ColorDot color={med?.color ?? '#64748b'} />
                <span className="font-medium">{med?.name ?? UNKNOWN_MED_NAME}</span>
                {dose !== member.normalDose && row.include && (
                  <span className="text-xs text-amber-400">adjusted</span>
                )}
              </label>

              {row.include && (
                <>
                  <Field label={`Dose (${med?.unit ?? ''})`}>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      className={inputClass}
                      value={row.doseStr}
                      onChange={(e) =>
                        patchRow(member.medId, { doseStr: e.target.value, confirmed: false })
                      }
                      aria-label={`${med?.name ?? UNKNOWN_MED_NAME} dose`}
                    />
                  </Field>
                  {overCap && (
                    <div className="rounded-md border border-red-700 bg-red-950/50 p-2 text-xs">
                      <ul className="list-disc pl-5 text-red-200">
                        {warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                      <label className="mt-2 flex items-center gap-2 text-red-200">
                        <input
                          type="checkbox"
                          checked={row.confirmed}
                          onChange={(e) => patchRow(member.medId, { confirmed: e.target.checked })}
                        />
                        {(() => {
                          const kind = classifyGuardrailBreach(warnings);
                          const adj =
                            kind === 'over-cap'
                              ? 'over-cap '
                              : kind === 'too-soon'
                                ? 'too-soon '
                                : '';
                          return `Log this ${adj}dose anyway.`;
                        })()}
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={anyOverCap ? 'danger' : 'primary'} disabled={!canLog} onClick={submit}>
            {anyOverCap
              ? groupBreachKind === 'over-cap'
                ? 'Log over-cap group'
                : groupBreachKind === 'too-soon'
                  ? 'Log too-soon group'
                  : 'Log group anyway'
              : `Log ${included.length || ''} dose${included.length === 1 ? '' : 's'}`.trim()}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
