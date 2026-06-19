// Oura Ring health data — pure domain shaping, daily bucketing, and
// correlation math. See specs/stage-13-oura-integration.md.
//
// This module models the Oura API v2 response schemas (Daily Readiness + Daily
// Stress), normalises them into one per-day summary, and overlays those metrics
// against the medication adherence timeline so the UI can render correlations.
// It is PURE TypeScript: no React, no store, no I/O, no network. The HTTP client
// and the mock/auth seam live in `src/oura/`.
//
// Time rule (CLAUDE.md): events carry an absolute instant; we bucket them into a
// calendar day in the app's ACTIVE zone via `isoDateInZone`, never the host zone.

import { isoDateInZone } from './time';
import type { AdherenceDay } from './history';
import type { IanaZone, ISODate, Instant } from './types';

// ---------------------------------------------------------------------------
// Oura API v2 response schemas (https://cloud.ouraring.com/v2/docs)
//
// Modelled directly from the documented `DailyReadinessModel` and
// `DailyStressModel`. Numeric fields are nullable in the API when Oura lacks the
// data for that day, so we keep them `| null`.
// ---------------------------------------------------------------------------

/** Contributing factors to the readiness score (each 1-100, or null). */
export interface OuraReadinessContributors {
  activity_balance: number | null;
  body_temperature: number | null;
  hrv_balance: number | null;
  previous_day_activity: number | null;
  previous_night: number | null;
  recovery_index: number | null;
  resting_heart_rate: number | null;
  sleep_balance: number | null;
}

/** `GET /v2/usercollection/daily_readiness` document. */
export interface OuraDailyReadiness {
  id: string;
  contributors: OuraReadinessContributors;
  day: ISODate; // local calendar day per the Oura account, "YYYY-MM-DD"
  score: number | null; // readiness score, 1-100
  temperature_deviation: number | null; // °C from baseline
  temperature_trend_deviation: number | null;
  timestamp: string; // ISO 8601 with offset, e.g. "2026-06-01T00:00:00+01:00"
}

/** Qualitative day classification on the Daily Stress document. */
export type OuraStressDaySummary = 'restored' | 'normal' | 'stressful';

/** `GET /v2/usercollection/daily_stress` document. */
export interface OuraDailyStress {
  id: string;
  day: ISODate; // local calendar day, "YYYY-MM-DD"
  stress_high: number | null; // seconds spent in high stress
  recovery_high: number | null; // seconds spent in recovery
  day_summary: OuraStressDaySummary | null;
}

/**
 * The standard Oura v2 paginated collection envelope. `next_token` is non-null
 * when more pages exist (passed back as the `next_token` query param).
 */
export interface OuraCollectionResponse<T> {
  data: T[];
  next_token: string | null;
}

// ---------------------------------------------------------------------------
// Normalised per-day summary
// ---------------------------------------------------------------------------

/**
 * One day's merged Oura metrics, keyed by an `ISODate` resolved in the active
 * zone. This is the shape the store caches and the UI overlays against
 * adherence. Any metric Oura did not supply for that day stays `null`.
 */
export interface OuraDaySummary {
  day: ISODate;
  readinessScore: number | null;
  temperatureDeviation: number | null;
  /** The readiness document's absolute instant, if any (for display/debug). */
  readinessInstant: Instant | null;
  stressHighSeconds: number | null;
  recoveryHighSeconds: number | null;
  stressDaySummary: OuraStressDaySummary | null;
}

const SECONDS_PER_MINUTE = 60;

/** Seconds → whole minutes, or null. Used to make stress durations readable. */
export function secondsToMinutes(seconds: number | null): number | null {
  return seconds == null ? null : Math.round(seconds / SECONDS_PER_MINUTE);
}

function emptySummary(day: ISODate): OuraDaySummary {
  return {
    day,
    readinessScore: null,
    temperatureDeviation: null,
    readinessInstant: null,
    stressHighSeconds: null,
    recoveryHighSeconds: null,
    stressDaySummary: null,
  };
}

/**
 * Merge raw Daily Readiness + Daily Stress documents into one sorted array of
 * per-day summaries.
 *
 * Bucketing: the readiness document carries an absolute `timestamp`, so we
 * resolve its day in the app's ACTIVE zone (Time rule) rather than trusting the
 * Oura-account-local `day` — this keeps Oura days aligned with the adherence
 * timeline when the app zone differs from the ring's. The stress document has no
 * timestamp in v2, so we fall back to its provided `day` (documented limitation).
 * When multiple documents land on the same day, the last one wins.
 */
export function normalizeOuraData(
  readiness: readonly OuraDailyReadiness[],
  stress: readonly OuraDailyStress[],
  zone: IanaZone,
): OuraDaySummary[] {
  const byDay = new Map<ISODate, OuraDaySummary>();
  const upsert = (day: ISODate): OuraDaySummary => {
    let summary = byDay.get(day);
    if (!summary) {
      summary = emptySummary(day);
      byDay.set(day, summary);
    }
    return summary;
  };

  for (const r of readiness) {
    const instant = Date.parse(r.timestamp);
    const usable = Number.isFinite(instant);
    const day = usable ? isoDateInZone(instant, zone) : r.day;
    const summary = upsert(day);
    summary.readinessScore = r.score;
    summary.temperatureDeviation = r.temperature_deviation;
    summary.readinessInstant = usable ? instant : null;
  }

  for (const s of stress) {
    const summary = upsert(s.day);
    summary.stressHighSeconds = s.stress_high;
    summary.recoveryHighSeconds = s.recovery_high;
    summary.stressDaySummary = s.day_summary;
  }

  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Correlation overlay (Oura metrics vs medication adherence)
// ---------------------------------------------------------------------------

/**
 * One aligned point joining an Oura day to that day's adherence. `adherenceRatio`
 * is taken/expected for timing-sensitive meds (null when nothing was expected,
 * so it never reads as 0% on a no-dose day).
 */
export interface OuraOverlayPoint {
  date: ISODate;
  readinessScore: number | null;
  stressHighMinutes: number | null;
  adherenceRatio: number | null; // 0..1, or null when expected === 0
  expected: number;
  taken: number;
}

/**
 * Join the normalised Oura summaries with the adherence timeline by calendar
 * day, preserving the adherence timeline's date axis (the chart's x-axis). Days
 * with no Oura data carry nulls for the Oura metrics.
 */
export function buildOuraOverlay(
  summaries: readonly OuraDaySummary[],
  adherenceDays: readonly AdherenceDay[],
): OuraOverlayPoint[] {
  const byDay = new Map<ISODate, OuraDaySummary>();
  for (const s of summaries) byDay.set(s.day, s);

  return adherenceDays.map((d) => {
    const oura = byDay.get(d.date);
    return {
      date: d.date,
      readinessScore: oura?.readinessScore ?? null,
      stressHighMinutes: secondsToMinutes(oura?.stressHighSeconds ?? null),
      adherenceRatio: d.expected > 0 ? d.taken / d.expected : null,
      expected: d.expected,
      taken: d.taken,
    };
  });
}

/**
 * Pearson correlation coefficient of two equal-length series, ignoring index
 * positions where either value is null. Returns null when fewer than two paired
 * points remain or either side has zero variance (coefficient undefined).
 */
export function pearson(
  xs: readonly (number | null)[],
  ys: readonly (number | null)[],
): number | null {
  const pairs: Array<[number, number]> = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x == null || y == null) continue;
    pairs.push([x, y]);
  }
  if (pairs.length < 2) return null;

  const count = pairs.length;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / count;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / count;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

/** Which Oura metric to correlate against adherence. */
export type OuraMetric = 'readiness' | 'stress';

export interface OuraCorrelation {
  metric: OuraMetric;
  coefficient: number | null; // Pearson r in [-1, 1], or null when undefined
  n: number; // number of paired days used
}

/**
 * Correlate an Oura metric against the daily adherence ratio over the overlay.
 * `readiness` uses the readiness score; `stress` uses high-stress minutes.
 */
export function correlateAdherence(
  points: readonly OuraOverlayPoint[],
  metric: OuraMetric,
): OuraCorrelation {
  const metricValues = points.map((p) =>
    metric === 'readiness' ? p.readinessScore : p.stressHighMinutes,
  );
  const adherence = points.map((p) => p.adherenceRatio);
  const paired = points.filter((_, i) => metricValues[i] != null && adherence[i] != null).length;
  return { metric, coefficient: pearson(metricValues, adherence), n: paired };
}
