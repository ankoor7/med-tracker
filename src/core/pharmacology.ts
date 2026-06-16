// Pharmacology extension interface — see specs/02-architecture.md §11.
//
// SteadyDose computes NO pharmacology. Self-hosters replace `noopStrategy` with
// their own equations by implementing `DoseAdjustmentStrategy`; no other code
// changes are required. Any returned `suggestedDose` is passed through the same
// `checkGuardrails` validator before it is ever offered to the user.

import type { DoseLogEntry, Instant, Medication } from './types';

export interface AdjustmentContext {
  med: Medication;
  scheduledInstant: Instant;
  actualInstant: Instant; // when the user is logging
  recentDoses: DoseLogEntry[]; // prior taken doses for this med
}

export interface AdjustmentResult {
  suggestedDose: number; // in med.unit
  rationale?: string;
}

/** One point on a predicted blood-level curve, supplied by the extension. */
export interface LevelPoint {
  t: Instant;
  level: number; // in `LevelSeries.unit`
}

/** Inputs the extension may use to compute a level series. The app computes none. */
export interface LevelSeriesContext {
  med: Medication;
  doses: DoseLogEntry[]; // taken doses for this med, ascending by actualInstant
  from: Instant;
  to: Instant;
}

/** A predicted level series for rendering only — produced solely by the extension. */
export interface LevelSeries {
  points: LevelPoint[];
  unit?: string;
  /** Optional therapeutic target band, drawn as a shaded region if present. */
  targetBand?: { low: number; high: number };
}

export interface DoseAdjustmentStrategy {
  computeAdjustment(ctx: AdjustmentContext): AdjustmentResult | null;
  /**
   * Optional (Stage 7): predicted blood-level series for the level chart. The
   * app renders exactly what this returns and NEVER synthesises a curve itself;
   * a missing method or `null` yields an explanatory empty state (FR-7.3/AC4).
   */
  levelSeries?(ctx: LevelSeriesContext): LevelSeries | null;
}

// Default: no suggestion, no level series. The app originates no dose value and
// invents no pharmacokinetic curve.
export const noopStrategy: DoseAdjustmentStrategy = {
  computeAdjustment() {
    return null;
  },
  levelSeries() {
    return null;
  },
};

/** Safe accessor: returns the extension's level series, or null if unsupported. */
export function levelSeriesFor(
  strategy: DoseAdjustmentStrategy,
  ctx: LevelSeriesContext,
): LevelSeries | null {
  return strategy.levelSeries ? strategy.levelSeries(ctx) : null;
}

// The strategy the app uses. Self-hosters swap this for their own module.
export const activeStrategy: DoseAdjustmentStrategy = noopStrategy;
