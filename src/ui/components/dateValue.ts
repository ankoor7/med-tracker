// Conversions between the store's `'YYYY-MM-DD'` `ISODate` strings and React
// Aria's `@internationalized/date` `CalendarDate` values, used by the
// `DateField` primitive and its callers (`StartDateField`). Kept in its own
// module so `fields.tsx` exports components only (react-refresh).

import { CalendarDate, parseDate } from '@internationalized/date';
import type { DateValue } from 'react-aria-components';

/** `'YYYY-MM-DD'` → a React Aria `CalendarDate`, or null for an unset value. */
export function toDateValue(iso: string): CalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  try {
    return parseDate(iso);
  } catch {
    return null;
  }
}

/** A React Aria date value → the `'YYYY-MM-DD'` string the store speaks. */
export function fromDateValue(d: DateValue | null): string {
  if (d == null) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}
