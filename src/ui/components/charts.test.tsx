import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdherenceChart } from './AdherenceChart';
import {
  levelSeriesFor,
  noopStrategy,
  type AdherenceDay,
  type DoseAdjustmentStrategy,
  type LevelSeries,
} from '../../core';
import { med } from '../../test/fixtures';

const days: AdherenceDay[] = [
  { date: '2026-06-15', taken: 2, missed: 0, expected: 2 },
  { date: '2026-06-16', taken: 1, missed: 1, expected: 2 },
];

describe('AdherenceChart', () => {
  it('renders a labelled bar chart (AC2)', () => {
    render(<AdherenceChart days={days} />);
    expect(
      screen.getByRole('img', { name: /adherence over the last 2 days/i }),
    ).toBeInTheDocument();
  });
});

describe('levelSeriesFor (developer-facing extension seam only, AC12 — no UI surface)', () => {
  it('returns null for the default no-op strategy', () => {
    expect(
      levelSeriesFor(noopStrategy, { med: med({ id: 'm1' }), doses: [], from: 0, to: 1 }),
    ).toBeNull();
  });

  it('returns exactly what a provided extension yields', () => {
    const series: LevelSeries = { points: [{ t: 0, level: 5 }] };
    const strategy: DoseAdjustmentStrategy = {
      computeAdjustment: () => null,
      levelSeries: () => series,
    };
    expect(levelSeriesFor(strategy, { med: med({ id: 'm1' }), doses: [], from: 0, to: 1 })).toBe(
      series,
    );
  });
});
