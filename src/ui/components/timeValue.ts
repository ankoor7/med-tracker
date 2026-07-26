// Conversions between the store's `'HH:MM'` wall-clock strings and React Aria's
// `@internationalized/date` `Time` values, used by the `TimeField` primitive and
// its callers (the merged medication editor and the by-time slot editor). Kept in
// their own module so `fields.tsx` exports components only (react-refresh).

import { Time } from '@internationalized/date';
import type { TimeValue } from 'react-aria-components';

/** `'HH:MM'` → a React Aria `Time`, or null for an unset/incomplete value. */
export function toTimeValue(hhmm: string): Time | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? new Time(Number(m[1]), Number(m[2])) : null;
}

/** A React Aria time value → the `'HH:MM'` wall-clock string the store speaks. */
export function fromTimeValue(t: TimeValue | null): string {
  if (t == null) return '';
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}
