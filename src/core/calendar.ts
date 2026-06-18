// Daily-calendar geometry & drag math — pure. See specs/stage-13-calendar-drag-dose-times.md.
//
// The day view is a vertical time-of-day axis: the top edge is midnight at the
// start of the day in the *active* zone and one hour spans `pxPerHour` pixels.
// All helpers map between UTC instants and vertical pixels using real elapsed
// time, and resolve day boundaries via the zone-aware `time.ts` conversions —
// never the host zone implicitly (architecture §6).
//
// Dragging a dose block only moves a dose *time*; it never originates a dose
// value (PRD safety invariant). The amount stays with the existing entry /
// override; guardrail re-validation happens in the store via the shared
// `checkGuardrails`.

import {
  HOUR_MS,
  TIME_STEP_MS,
  addDaysToIsoDate,
  resolveWallTimeToInstant,
  roundInstantToStep,
} from './time';
import type { IanaZone, ISODate, Instant } from './types';

/** Default pixel height of one hour row in the day view. */
export const DEFAULT_PX_PER_HOUR = 48;

/** Hours rendered on the axis (00:00 … 24:00). */
export const HOURS_IN_DAY = 24;

/** Midnight at the start of `date` in `zone`, as a UTC instant. */
export function dayStartInstant(date: ISODate, zone: IanaZone): Instant {
  return resolveWallTimeToInstant(date, '00:00', zone);
}

/** Midnight at the end of `date` (i.e. start of the next day) in `zone`. */
export function dayEndInstant(date: ISODate, zone: IanaZone): Instant {
  return resolveWallTimeToInstant(addDaysToIsoDate(date, 1), '00:00', zone);
}

/**
 * Vertical pixel offset (from the top of the day) at which `instant` sits, given
 * the day's start instant and the row height. Uses real elapsed ms so it stays
 * monotonic across a DST boundary.
 */
export function instantToDayY(instant: Instant, dayStart: Instant, pxPerHour: number): number {
  return ((instant - dayStart) / HOUR_MS) * pxPerHour;
}

/** Inverse of `instantToDayY`: the instant a pixel offset corresponds to. */
export function dayYToInstant(y: number, dayStart: Instant, pxPerHour: number): Instant {
  return dayStart + (y / pxPerHour) * HOUR_MS;
}

/** Clamp `instant` into the inclusive `[min, max]` range. */
export function clampInstant(instant: Instant, min: Instant, max: Instant): Instant {
  if (instant < min) return min;
  if (instant > max) return max;
  return instant;
}

export interface DragResolveOptions {
  /** The instant the block was anchored at when the drag began. */
  originalInstant: Instant;
  /** Vertical pointer movement in pixels (down is positive, later in the day). */
  deltaY: number;
  /** Row height used to convert pixels back to time. */
  pxPerHour: number;
  /** Earliest allowed instant (typically the day start). */
  min: Instant;
  /** Latest allowed instant (typically the day end, or "now" for taken doses). */
  max: Instant;
  /** Snap granularity; defaults to the shared 5-minute step. */
  stepMs?: number;
}

/**
 * Resolve a drag gesture into the committed instant: convert the pixel delta to
 * elapsed time, add it to the anchor, snap to the step grid, and clamp into the
 * allowed range. Pure — the heart of the drag interaction, unit-tested in
 * isolation. The live display value while dragging comes from `wallTimeInZone`.
 */
export function resolveDraggedInstant(opts: DragResolveOptions): Instant {
  const { originalInstant, deltaY, pxPerHour, min, max, stepMs = TIME_STEP_MS } = opts;
  const raw = originalInstant + (deltaY / pxPerHour) * HOUR_MS;
  const snapped = roundInstantToStep(clampInstant(raw, min, max), stepMs);
  // Snapping can nudge a near-boundary value just past the edge; re-clamp.
  return clampInstant(snapped, min, max);
}
