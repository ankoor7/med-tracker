// Shared AC9 test suite for the Stage 18 FR-18.9(b) future-clamp-and-explain
// contract: a future dragged/typed "time taken" is clamped to now AND the
// clamp is surfaced, never silently swapped. `DoseLogger.test.tsx` and
// `GroupLogger.test.tsx` exercise the identical contract against two
// different logger components — `describeFutureClampContract` runs the same
// four cases against whichever one is handed to it, so the case bodies live
// in exactly one place instead of being hand-duplicated across both files.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { datetimeLocalToInstant, instantToDatetimeLocal, type IanaZone } from '../core';

const FUTURE_CLAMP_MESSAGE = /can't log a dose in the future/i;

/** Locate the "Time taken" datetime-local input in the currently-open logger. */
function getTimeTakenInput(): HTMLInputElement {
  return screen.getByLabelText('Time taken') as HTMLInputElement;
}

/** Assert the "can't log a dose in the future" explanation is visible. */
function expectFutureClampMessage(): void {
  expect(screen.getByText(FUTURE_CLAMP_MESSAGE)).toBeInTheDocument();
}

/** Assert the future-clamp explanation is absent (past/present time). */
function expectNoFutureClampMessage(): void {
  expect(screen.queryByText(FUTURE_CLAMP_MESSAGE)).not.toBeInTheDocument();
}

/**
 * Assert the full future-clamp contract for an already-rendered logger: the
 * "Time taken" input never shows an instant later than `now`, and the
 * "can't log a dose in the future" explanation is visible. Reads the input's
 * datetime-local value back through the component's own `zone` — a naive
 * `new Date(value)` parse assumes the host's local timezone, which drifts
 * from a non-UTC test `zone` (e.g. `Europe/London` in BST) by the zone's
 * offset and falsely fails.
 */
function expectFutureClamped(input: HTMLInputElement, now: number, zone: IanaZone): void {
  expect(datetimeLocalToInstant(input.value, zone)).toBeLessThanOrEqual(now);
  expectFutureClampMessage();
}

/**
 * Run the AC9 future-clamp contract against a logger component.
 *
 * @param componentLabel Name used in the `describe` block (e.g. "DoseLogger").
 * @param renderLogger Renders the component under test. Called with the
 *   target's `actualInstant` override (undefined = no override, i.e. the
 *   component's own "now" default applies).
 * @param now The fixed "now" the test's clock is pinned to.
 * @param zone The active zone the logger under test renders its "Time taken"
 *   input in (must match the `settings({ zone })` the test seeds the store
 *   with), so the input's value round-trips through the same zone it was
 *   written in.
 */
export function describeFutureClampContract(
  componentLabel: string,
  renderLogger: (actualInstant: number | undefined) => void,
  now: number,
  zone: IanaZone,
): void {
  describe(`${componentLabel} — future retime is never silently swapped for "now" (AC9)`, () => {
    it('a target actualInstant in the future is clamped to now, with a visible explanation', () => {
      renderLogger(now + 3600_000);
      expectFutureClamped(getTimeTakenInput(), now, zone);
    });

    it('a target actualInstant in the past shows no future-clamp explanation', () => {
      renderLogger(now - 3600_000);
      expectNoFutureClampMessage();
    });

    it('manually typing a future time also clamps with the explanation, not silently', () => {
      renderLogger(undefined);
      fireEvent.change(getTimeTakenInput(), {
        target: { value: instantToDatetimeLocal(now + 2 * 3600_000, zone) },
      });
      expectFutureClamped(getTimeTakenInput(), now, zone);
    });

    it('the explanation clears once the time is moved back to the past', () => {
      renderLogger(now + 3600_000);
      expectFutureClampMessage();

      fireEvent.click(screen.getByText('Now'));
      expectNoFutureClampMessage();
    });
  });
}
