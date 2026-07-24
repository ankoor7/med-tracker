// Shared date-input + warning pair for a medication's `startedAt` (Stage 18
// FR-18.1 piece 3). Used by both the add/edit medication form and the
// upgrade-time prompt so the two warning checks (future date; a dose already
// logged before it) live in one place rather than being re-derived at each
// call site.

import { Fragment } from 'react';
import { hasDoseLoggedBefore, isFutureStartDate, startOfDayInstant } from '../../core';
import type { DoseLogEntry, IanaZone, ISODate } from '../../core';
import { Field, inputClass } from './ui';

export interface StartDateFieldProps {
  label: string;
  ariaLabel?: string;
  value: ISODate | '';
  onChange: (value: string) => void;
  zone: IanaZone;
  doseLog: DoseLogEntry[];
  /** Omit for a medication not yet created — there is nothing to check against. */
  medId?: string;
}

export function StartDateField({
  label,
  ariaLabel,
  value,
  onChange,
  zone,
  doseLog,
  medId,
}: StartDateFieldProps) {
  const future = value !== '' && isFutureStartDate(value, Date.now(), zone);
  const beforeLoggedDose =
    value !== '' &&
    medId != null &&
    hasDoseLoggedBefore(doseLog, medId, startOfDayInstant(value, zone));

  return (
    <Fragment>
      <Field label={label}>
        <input
          type="date"
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={ariaLabel ?? label}
        />
      </Field>
      {future && <p className="-mt-2 text-xs text-amber-400">This date is in the future.</p>}
      {beforeLoggedDose && (
        <p className="-mt-2 text-xs text-amber-400">A dose is already logged before this date.</p>
      )}
    </Fragment>
  );
}
