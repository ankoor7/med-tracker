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
  {
    date: '2026-06-15',
    onTime: 2,
    late: 0,
    taken: 2,
    missed: 0,
    skipped: 0,
    expected: 2,
    assumedOnTime: 0,
  },
  {
    date: '2026-06-16',
    onTime: 1,
    late: 0,
    taken: 1,
    missed: 1,
    skipped: 0,
    expected: 2,
    assumedOnTime: 0,
  },
];

describe('AdherenceChart', () => {
  it('renders a labelled bar chart (AC2)', () => {
    render(<AdherenceChart days={days} />);
    expect(
      screen.getByRole('img', { name: /adherence over the last 2 days/i }),
    ).toBeInTheDocument();
  });

  // Stage 21 FR-21.3 — the re-theme must not collapse the assumed-vs-logged
  // distinction (Stage 18 FR-18.6) back into colour alone. Both cues have to
  // survive: the chart's own accessible name, and a non-colour (hatch) mark
  // on the bar itself, distinct from a plain colour fill.
  it('marks an assumed portion with a non-colour hatch cue and discloses it in the accessible name', () => {
    const daysWithAssumed: AdherenceDay[] = [
      {
        date: '2026-06-15',
        onTime: 2,
        assumedOnTime: 2,
        late: 0,
        taken: 2,
        missed: 0,
        skipped: 0,
        expected: 2,
      },
    ];
    const { container } = render(<AdherenceChart days={daysWithAssumed} />);
    expect(
      screen.getByRole('img', { name: /hatched segments are assumed on time, not logged/i }),
    ).toBeInTheDocument();
    // The hatched segment itself carries its own label, independent of the
    // chart's overall aria-label — a texture cue, not a colour one.
    expect(container.querySelector('[aria-label="assumed, not logged"]')).toBeInTheDocument();
  });

  // Stage 21 FR-21.2 — a patient reads "what did I take, what did I miss"
  // from text labels, not by decoding four bar colours from memory. A day
  // with nothing assumed shows no "assumed" legend entry — an empty
  // legend slot is a broken cue, not a benign one.
  it('renders a text legend naming every bar state so colour is never the only cue', () => {
    render(<AdherenceChart days={days} />);
    expect(screen.getByText('On time')).toBeInTheDocument();
    expect(screen.getByText('Late')).toBeInTheDocument();
    expect(screen.getByText('Missed')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.queryByText('Assumed on time (not logged)')).not.toBeInTheDocument();
  });

  it('legend includes the assumed entry only when the data actually has an assumed portion', () => {
    const daysWithAssumed: AdherenceDay[] = [
      {
        date: '2026-06-15',
        onTime: 1,
        assumedOnTime: 1,
        late: 0,
        taken: 1,
        missed: 0,
        skipped: 0,
        expected: 1,
      },
    ];
    render(<AdherenceChart days={daysWithAssumed} />);
    expect(screen.getByText('Assumed on time (not logged)')).toBeInTheDocument();
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
