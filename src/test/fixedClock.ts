// Shared `vi.useFakeTimers()` + fixed `Date.now()` fixture for screen tests
// that need a stable "now" (Today/History render relative to the clock).
// Extracted (Stage 18) so the fixture isn't copy-pasted per test file.
import { afterEach, beforeEach, vi } from 'vitest';

export function withFixedClock(now: number): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
