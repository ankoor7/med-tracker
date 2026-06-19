// Realistic offline Oura fixtures + a deterministic generator.
//
// Two roles:
//   - FIXTURE_READINESS / FIXTURE_STRESS: small, fixed-date sample payloads that
//     mirror real v2 responses, used by unit tests and as a stable reference.
//   - generateOuraFixtures(range): deterministic synthetic data for ANY requested
//     date range, so the MockOuraClient can return health data near "today" that
//     overlays meaningfully against the live adherence timeline — all offline,
//     no network, no credentials.

import { addDaysToIsoDate } from '../core/time';
import type { OuraDailyReadiness, OuraDailyStress } from '../core/oura';
import type { ISODate } from '../core/types';
import type { OuraDateRange } from './ouraClient';

// ---------------------------------------------------------------------------
// Fixed-date sample (shape-accurate to the v2 docs). Three consecutive days.
// ---------------------------------------------------------------------------

export const FIXTURE_READINESS: OuraDailyReadiness[] = [
  {
    id: 'fixture-readiness-2026-06-01',
    contributors: {
      activity_balance: 82,
      body_temperature: 98,
      hrv_balance: 74,
      previous_day_activity: 80,
      previous_night: 71,
      recovery_index: 88,
      resting_heart_rate: 95,
      sleep_balance: 79,
    },
    day: '2026-06-01',
    score: 84,
    temperature_deviation: 0.1,
    temperature_trend_deviation: 0.0,
    timestamp: '2026-06-01T03:30:00+01:00',
  },
  {
    id: 'fixture-readiness-2026-06-02',
    contributors: {
      activity_balance: 70,
      body_temperature: 88,
      hrv_balance: 55,
      previous_day_activity: 68,
      previous_night: 60,
      recovery_index: 72,
      resting_heart_rate: 80,
      sleep_balance: 64,
    },
    day: '2026-06-02',
    score: 67,
    temperature_deviation: 0.4,
    temperature_trend_deviation: 0.2,
    timestamp: '2026-06-02T03:25:00+01:00',
  },
  {
    id: 'fixture-readiness-2026-06-03',
    contributors: {
      activity_balance: 90,
      body_temperature: 99,
      hrv_balance: 85,
      previous_day_activity: 88,
      previous_night: 84,
      recovery_index: 92,
      resting_heart_rate: 96,
      sleep_balance: 88,
    },
    day: '2026-06-03',
    score: 91,
    temperature_deviation: -0.1,
    temperature_trend_deviation: 0.0,
    timestamp: '2026-06-03T03:40:00+01:00',
  },
];

export const FIXTURE_STRESS: OuraDailyStress[] = [
  {
    id: 'fixture-stress-2026-06-01',
    day: '2026-06-01',
    stress_high: 7200,
    recovery_high: 14400,
    day_summary: 'normal',
  },
  {
    id: 'fixture-stress-2026-06-02',
    day: '2026-06-02',
    stress_high: 18000,
    recovery_high: 5400,
    day_summary: 'stressful',
  },
  {
    id: 'fixture-stress-2026-06-03',
    day: '2026-06-03',
    stress_high: 3600,
    recovery_high: 21600,
    day_summary: 'restored',
  },
];

// ---------------------------------------------------------------------------
// Deterministic synthetic generator (for the running app's mock mode).
// ---------------------------------------------------------------------------

/** Stable 0..1 pseudo-random seeded by a string (no Math.random — deterministic). */
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // >>> 0 to unsigned, then normalise.
  return ((h >>> 0) % 1000) / 1000;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Inclusive list of ISO dates from start to end. Empty if the range is reversed. */
function datesInRange(range: OuraDateRange): ISODate[] {
  const dates: ISODate[] = [];
  let cursor = range.startDate;
  // Guard against a runaway loop on a bad range (cap at ~3 years).
  for (let i = 0; i < 1100 && cursor <= range.endDate; i++) {
    dates.push(cursor);
    cursor = addDaysToIsoDate(cursor, 1);
  }
  return dates;
}

/**
 * Synthesise readiness + stress for every day in `range`. Deterministic per date,
 * with a deliberate mild inverse relationship between stress and readiness so the
 * correlation visualisations have something believable to surface.
 */
export function generateOuraFixtures(range: OuraDateRange): {
  readiness: OuraDailyReadiness[];
  stress: OuraDailyStress[];
} {
  const readiness: OuraDailyReadiness[] = [];
  const stress: OuraDailyStress[] = [];

  for (const day of datesInRange(range)) {
    const base = hash01(day);
    const wobble = hash01(`${day}-x`);

    const score = Math.round(clamp(55 + base * 40, 1, 100));
    // Higher stress on lower-readiness days (inverse-ish), plus daily wobble.
    const stressHigh = Math.round(clamp((100 - score) * 240 + wobble * 1800, 0, 28800));
    const recoveryHigh = Math.round(clamp(score * 200 + wobble * 1200, 0, 28800));
    const daySummary = score >= 85 ? 'restored' : score <= 62 ? 'stressful' : ('normal' as const);

    readiness.push({
      id: `mock-readiness-${day}`,
      contributors: {
        activity_balance: Math.round(clamp(score + wobble * 10 - 5, 1, 100)),
        body_temperature: Math.round(clamp(90 + base * 10, 1, 100)),
        hrv_balance: Math.round(clamp(score - 10 + wobble * 15, 1, 100)),
        previous_day_activity: Math.round(clamp(score + 3, 1, 100)),
        previous_night: Math.round(clamp(score - 5, 1, 100)),
        recovery_index: Math.round(clamp(score + 4, 1, 100)),
        resting_heart_rate: Math.round(clamp(score + 8, 1, 100)),
        sleep_balance: Math.round(clamp(score - 2, 1, 100)),
      },
      day,
      score,
      temperature_deviation: Number((wobble - 0.5).toFixed(2)),
      temperature_trend_deviation: Number(((wobble - 0.5) / 2).toFixed(2)),
      // Reported just after midnight local time; the normaliser re-buckets by zone.
      timestamp: `${day}T03:30:00+00:00`,
    });

    stress.push({
      id: `mock-stress-${day}`,
      day,
      stress_high: stressHigh,
      recovery_high: recoveryHigh,
      day_summary: daySummary,
    });
  }

  return { readiness, stress };
}
