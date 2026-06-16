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

export interface DoseAdjustmentStrategy {
  computeAdjustment(ctx: AdjustmentContext): AdjustmentResult | null;
}

// Default: no suggestion. The app originates no dose value.
export const noopStrategy: DoseAdjustmentStrategy = {
  computeAdjustment() {
    return null;
  },
};

// The strategy the app uses. Self-hosters swap this for their own module.
export const activeStrategy: DoseAdjustmentStrategy = noopStrategy;
