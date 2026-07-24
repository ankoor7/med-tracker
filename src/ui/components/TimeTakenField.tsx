// The "Time taken" control shared by DoseLogger and GroupLogger: a
// datetime-local input, the Now/Scheduled/-15m/-30m/-1h presets (Stage 11
// FR-11.2), the on-time/late offset label, and — Stage 18 FR-18.9(b)/AC9 —
// the "can't log a dose in the future, snapped to now" explanation when the
// clamp actually bites. Extracted so this block (and its `PresetButton`
// helper) isn't hand-duplicated between the two logger dialogs.
import type { ReactNode } from 'react';
import { datetimeLocalToInstant, type Instant } from '../../core';
import { Field, inputClass } from './ui';

export function TimeTakenField({
  whenStr,
  zone,
  now,
  scheduledInstant,
  offsetLabel,
  futureClamped,
  onSetWhen,
  onNudge,
}: {
  whenStr: string;
  zone: string;
  now: Instant;
  scheduledInstant: Instant;
  offsetLabel: string;
  futureClamped: boolean;
  onSetWhen: (instant: Instant) => void;
  onNudge: (deltaMin: number) => void;
}) {
  return (
    <Field label="Time taken">
      <input
        type="datetime-local"
        step={300}
        className={inputClass}
        value={whenStr}
        onChange={(e) => onSetWhen(datetimeLocalToInstant(e.target.value, zone))}
        aria-label="Time taken"
      />
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <PresetButton onClick={() => onSetWhen(now)}>Now</PresetButton>
        <PresetButton onClick={() => onSetWhen(scheduledInstant)}>Scheduled</PresetButton>
        <PresetButton onClick={() => onNudge(-15)}>−15m</PresetButton>
        <PresetButton onClick={() => onNudge(-30)}>−30m</PresetButton>
        <PresetButton onClick={() => onNudge(-60)}>−1h</PresetButton>
        <span
          className={`ml-auto text-xs ${offsetLabel === 'on time' ? 'text-slate-400' : 'text-amber-400'}`}
        >
          {offsetLabel}
        </span>
      </div>
      {futureClamped && (
        <p role="status" className="mt-1 text-xs text-amber-400">
          You can&apos;t log a dose in the future — snapped to now.
        </p>
      )}
    </Field>
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
