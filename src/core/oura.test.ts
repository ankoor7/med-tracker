import { describe, expect, it } from 'vitest';
import {
  buildOuraOverlay,
  correlateAdherence,
  normalizeOuraData,
  pearson,
  secondsToMinutes,
  type OuraDailyReadiness,
  type OuraDailyStress,
  type OuraDaySummary,
} from './oura';
import type { AdherenceDay } from './history';

const ZONE = 'Europe/London';

/** An `AdherenceDay` with all-zero counts by default; override what a test cares about. */
function adherenceDay(date: string, over: Partial<AdherenceDay> = {}): AdherenceDay {
  return {
    date,
    onTime: 0,
    late: 0,
    taken: 0,
    missed: 0,
    skipped: 0,
    expected: 0,
    assumedOnTime: 0,
    ...over,
  };
}

function readiness(over: Partial<OuraDailyReadiness> = {}): OuraDailyReadiness {
  return {
    id: over.id ?? 'r1',
    contributors: over.contributors ?? {
      activity_balance: 80,
      body_temperature: 90,
      hrv_balance: 70,
      previous_day_activity: 85,
      previous_night: 75,
      recovery_index: 88,
      resting_heart_rate: 92,
      sleep_balance: 81,
    },
    day: over.day ?? '2026-06-01',
    score: over.score ?? 82,
    temperature_deviation: over.temperature_deviation ?? 0.1,
    temperature_trend_deviation: over.temperature_trend_deviation ?? 0.0,
    timestamp: over.timestamp ?? '2026-06-01T02:00:00+01:00',
  };
}

function stress(over: Partial<OuraDailyStress> = {}): OuraDailyStress {
  return {
    id: over.id ?? 's1',
    day: over.day ?? '2026-06-01',
    stress_high: over.stress_high ?? 3600,
    recovery_high: over.recovery_high ?? 7200,
    day_summary: over.day_summary ?? 'normal',
  };
}

describe('secondsToMinutes', () => {
  it('rounds seconds to whole minutes', () => {
    expect(secondsToMinutes(3600)).toBe(60);
    expect(secondsToMinutes(90)).toBe(2);
  });
  it('passes null through', () => {
    expect(secondsToMinutes(null)).toBeNull();
  });
});

describe('normalizeOuraData', () => {
  it('merges readiness and stress for the same day into one summary', () => {
    const out = normalizeOuraData([readiness()], [stress()], ZONE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      day: '2026-06-01',
      readinessScore: 82,
      temperatureDeviation: 0.1,
      stressHighSeconds: 3600,
      recoveryHighSeconds: 7200,
      stressDaySummary: 'normal',
    });
  });

  it('buckets readiness by the active zone from its absolute timestamp', () => {
    // 00:30 UTC on Jun 2 is 01:30 BST on Jun 2 (Europe/London) — still Jun 2 — but
    // in New York it is the evening of Jun 1. Verify the active zone wins over the
    // document `day`.
    const r = readiness({ day: '2026-06-02', timestamp: '2026-06-02T00:30:00Z' });
    const ny = normalizeOuraData([r], [], 'America/New_York');
    expect(ny[0]!.day).toBe('2026-06-01');
    const london = normalizeOuraData([r], [], ZONE);
    expect(london[0]!.day).toBe('2026-06-02');
  });

  it('falls back to the document day when the timestamp is unparseable', () => {
    const r = readiness({ day: '2026-06-03', timestamp: 'not-a-date' });
    const out = normalizeOuraData([r], [], ZONE);
    expect(out[0]).toMatchObject({ day: '2026-06-03', readinessInstant: null });
  });

  it('keeps stress-only and readiness-only days, sorted ascending', () => {
    const out = normalizeOuraData(
      [readiness({ day: '2026-06-02', timestamp: '2026-06-02T08:00:00+01:00', score: 70 })],
      [stress({ day: '2026-06-01' })],
      ZONE,
    );
    expect(out.map((d) => d.day)).toEqual(['2026-06-01', '2026-06-02']);
    expect(out[0]!.readinessScore).toBeNull();
    expect(out[1]!.stressHighSeconds).toBeNull();
  });
});

describe('pearson', () => {
  it('returns 1 for a perfect positive linear relationship', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });
  it('returns -1 for a perfect negative linear relationship', () => {
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 10);
  });
  it('ignores positions where either value is null', () => {
    expect(pearson([1, null, 3], [2, 99, 6])).toBeCloseTo(1, 10);
  });
  it('returns null with fewer than two paired points', () => {
    expect(pearson([1, null], [null, 2])).toBeNull();
  });
  it('returns null when a series has zero variance', () => {
    expect(pearson([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});

describe('buildOuraOverlay', () => {
  const adherence: AdherenceDay[] = [
    adherenceDay('2026-06-01', { onTime: 2, taken: 2, expected: 2 }),
    adherenceDay('2026-06-02', { onTime: 1, taken: 1, missed: 1, expected: 2 }),
    adherenceDay('2026-06-03'),
  ];
  const summaries: OuraDaySummary[] = [
    {
      day: '2026-06-01',
      readinessScore: 80,
      temperatureDeviation: 0,
      readinessInstant: null,
      stressHighSeconds: 1800,
      recoveryHighSeconds: 3600,
      stressDaySummary: 'normal',
    },
    {
      day: '2026-06-02',
      readinessScore: 60,
      temperatureDeviation: 0,
      readinessInstant: null,
      stressHighSeconds: 7200,
      recoveryHighSeconds: 1200,
      stressDaySummary: 'stressful',
    },
  ];

  it('joins on date, preserving the adherence timeline axis', () => {
    const points = buildOuraOverlay(summaries, adherence);
    expect(points.map((p) => p.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
  });

  it('computes adherenceRatio as onTime/expected, null when nothing expected', () => {
    const points = buildOuraOverlay(summaries, adherence);
    expect(points[0]!.adherenceRatio).toBe(1);
    expect(points[1]!.adherenceRatio).toBe(0.5);
    expect(points[2]!.adherenceRatio).toBeNull();
  });

  // Stage 18 FR-18.4 regression: a late dose is still `taken`, but must not
  // read as fully adherent here either, or this chart would silently disagree
  // with the History screen's headline figure for the same day.
  it('does not count a late dose as fully adherent', () => {
    const withLate: AdherenceDay[] = [
      adherenceDay('2026-06-01', { onTime: 1, late: 1, taken: 2, expected: 2 }),
    ];
    const points = buildOuraOverlay(summaries, withLate);
    expect(points[0]!.adherenceRatio).toBe(0.5); // onTime/expected, not taken/expected (which would be 1)
  });

  it('converts stress seconds to minutes and nulls missing Oura days', () => {
    const points = buildOuraOverlay(summaries, adherence);
    expect(points[0]!.stressHighMinutes).toBe(30);
    expect(points[2]!.readinessScore).toBeNull();
    expect(points[2]!.stressHighMinutes).toBeNull();
  });
});

describe('correlateAdherence', () => {
  const adherence: AdherenceDay[] = [
    adherenceDay('2026-06-01', { onTime: 2, taken: 2, expected: 2 }), // ratio 1.0
    adherenceDay('2026-06-02', { onTime: 1, taken: 1, missed: 1, expected: 2 }), // ratio 0.5
    adherenceDay('2026-06-03', { taken: 0, missed: 2, expected: 2 }), // ratio 0.0
  ];
  const summaries: OuraDaySummary[] = [
    s('2026-06-01', 90, 600),
    s('2026-06-02', 70, 1800),
    s('2026-06-03', 50, 3000),
  ];

  function s(day: string, score: number, stressSeconds: number): OuraDaySummary {
    return {
      day,
      readinessScore: score,
      temperatureDeviation: 0,
      readinessInstant: null,
      stressHighSeconds: stressSeconds,
      recoveryHighSeconds: 0,
      stressDaySummary: 'normal',
    };
  }

  it('finds readiness positively correlated with adherence here', () => {
    const points = buildOuraOverlay(summaries, adherence);
    const c = correlateAdherence(points, 'readiness');
    expect(c.metric).toBe('readiness');
    expect(c.n).toBe(3);
    expect(c.coefficient).toBeCloseTo(1, 10);
  });

  it('finds high-stress minutes negatively correlated with adherence here', () => {
    const points = buildOuraOverlay(summaries, adherence);
    const c = correlateAdherence(points, 'stress');
    expect(c.coefficient).toBeCloseTo(-1, 10);
  });

  it('reports n=0 and a null coefficient when no Oura data overlaps', () => {
    const points = buildOuraOverlay([], adherence);
    const c = correlateAdherence(points, 'readiness');
    expect(c).toEqual({ metric: 'readiness', coefficient: null, n: 0 });
  });
});
