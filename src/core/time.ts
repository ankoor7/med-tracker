// Timezone & time math — pure, DST-safe. See specs/02-architecture.md §6.
//
// Storage rule: every event is an absolute `Instant` (UTC epoch ms).
// Schedule wall-clock times are resolved to instants in the *active* zone via a
// two-pass offset calculation that is correct across DST boundaries. We never
// rely on the host machine's zone implicitly.

import type { IanaZone, ISODate, Instant, WallTime } from './types';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const PART_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function partFormatter(zone: IanaZone): Intl.DateTimeFormat {
  let fmt = PART_FMT_CACHE.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PART_FMT_CACHE.set(zone, fmt);
  }
  return fmt;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function readParts(instant: Instant, zone: IanaZone): ZonedParts {
  const parts = partFormatter(zone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const v = parts.find((p) => p.type === type)?.value;
    return v == null ? 0 : Number(v);
  };
  let hour = get('hour');
  // Some engines emit hour "24" for midnight; normalise to 0.
  if (hour === 24) hour = 0;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Parse "YYYY-MM-DD" into numeric parts. */
function parseIsoDate(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-');
  return [Number(y), Number(m), Number(d)];
}

/** Parse "HH:MM" into numeric parts. */
function parseWallTime(time: WallTime): [number, number] {
  const [h, m] = time.split(':');
  return [Number(h), Number(m)];
}

/**
 * Offset of `zone` relative to UTC at a given instant, in milliseconds.
 * Positive east of UTC (e.g. +3600000 for BST).
 */
export function zoneOffsetMs(instant: Instant, zone: IanaZone): number {
  const p = readParts(instant, zone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - instant;
}

/**
 * Resolve a wall-clock date+time in `zone` to a UTC instant.
 * Two-pass: guess using the offset at the naive instant, then recompute the
 * offset at the candidate instant to settle DST transitions.
 */
export function resolveWallTimeToInstant(date: ISODate, time: WallTime, zone: IanaZone): Instant {
  const [y, mo, d] = parseIsoDate(date);
  const [h, mi] = parseWallTime(time);
  const wallAsUTC = Date.UTC(y, mo - 1, d, h, mi, 0, 0);

  // Pass 1: offset at the naive instant.
  const offset1 = zoneOffsetMs(wallAsUTC, zone);
  const candidate = wallAsUTC - offset1;

  // Pass 2: offset at the candidate; if it differs (DST boundary), re-apply.
  const offset2 = zoneOffsetMs(candidate, zone);
  return offset1 === offset2 ? candidate : wallAsUTC - offset2;
}

/** The calendar date ("YYYY-MM-DD") that `instant` falls on, in `zone`. */
export function isoDateInZone(instant: Instant, zone: IanaZone): ISODate {
  const p = readParts(instant, zone);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

/** Wall-clock "HH:MM" that `instant` shows as, in `zone`. */
export function wallTimeInZone(instant: Instant, zone: IanaZone): WallTime {
  const p = readParts(instant, zone);
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Short zone abbreviation at `instant` — e.g. "GMT" or "BST" for Europe/London. */
export function zoneAbbreviation(instant: Instant, zone: IanaZone): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(new Date(instant));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** Human label like "08:00 BST" for `instant` in `zone`. */
export function formatTimeWithZone(instant: Instant, zone: IanaZone): string {
  return `${wallTimeInZone(instant, zone)} ${zoneAbbreviation(instant, zone)}`.trim();
}

/** Full label like "2026-06-15 08:05 BST". */
export function formatDateTimeWithZone(instant: Instant, zone: IanaZone): string {
  return `${isoDateInZone(instant, zone)} ${formatTimeWithZone(instant, zone)}`;
}

/**
 * Convert a `<input type="datetime-local">` value ("YYYY-MM-DDTHH:MM") into a
 * UTC instant, interpreting it in the *active app zone* (never the host zone).
 */
export function datetimeLocalToInstant(value: string, zone: IanaZone): Instant {
  const [date, time] = value.split('T');
  return resolveWallTimeToInstant(date ?? '1970-01-01', (time ?? '00:00').slice(0, 5), zone);
}

/**
 * Inverse: render an instant as a "YYYY-MM-DDTHH:MM" value for a datetime-local
 * input, in `zone`. Used to seed the logger's "time taken" default.
 */
export function instantToDatetimeLocal(instant: Instant, zone: IanaZone): string {
  return `${isoDateInZone(instant, zone)}T${wallTimeInZone(instant, zone)}`;
}

/** Real elapsed hours between two instants (timezone-invariant). */
export function hoursBetween(a: Instant, b: Instant): number {
  return Math.abs(b - a) / HOUR_MS;
}

/** Default granularity for "time taken" entry: 5 minutes (Stage 11 FR-11.1). */
export const TIME_STEP_MS = 5 * MINUTE_MS;

/** Round an instant to the nearest `stepMs` (default 5 min). Ties round up. */
export function roundInstantToStep(instant: Instant, stepMs: number = TIME_STEP_MS): Instant {
  return Math.round(instant / stepMs) * stepMs;
}

/**
 * Human-readable offset of `actual` from `scheduled`, e.g. "2h 30m late",
 * "10m early", "on time". Pure and DST-agnostic (compares elapsed ms). Anything
 * within `toleranceMs` of the schedule reads as "on time" (Stage 11 FR-11.3).
 */
export function describeOffset(
  actual: Instant,
  scheduled: Instant,
  toleranceMs: number = MINUTE_MS,
): string {
  const delta = actual - scheduled;
  if (Math.abs(delta) <= toleranceMs) return 'on time';
  const dir = delta > 0 ? 'late' : 'early';
  const totalMin = Math.round(Math.abs(delta) / MINUTE_MS);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const parts = [h > 0 ? `${h}h` : '', m > 0 ? `${m}m` : ''].filter(Boolean);
  return `${parts.join(' ') || '0m'} ${dir}`;
}

/** Add days to an ISO date (calendar arithmetic, zone-agnostic). */
export function addDaysToIsoDate(date: ISODate, days: number): ISODate {
  const [y, mo, d] = parseIsoDate(date);
  const t = Date.UTC(y, mo - 1, d) + days * DAY_MS;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

export { MINUTE_MS, HOUR_MS };
