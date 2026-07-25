// Stage 18 FR-18.9(b)/AC9: a future dragged/typed time must never be silently
// swapped for "now" — it's clamped to now AND the swap is explained. Before
// this fix, `Math.min(target.actualInstant ?? now, now)` at mount (and the
// manual "Time taken" input, which previously bypassed clamping entirely)
// discarded a future time with no trace. The four AC9 cases are shared with
// GroupLogger.test.tsx via `describeFutureClampContract` — same contract,
// two different logger components.
import { render } from '@testing-library/react';
import { beforeEach } from 'vitest';
import { DoseLogger, type LoggerTarget } from './DoseLogger';
import { useStore } from '../../store/store';
import { med, settings } from '../../test/fixtures';
import { withFixedClock } from '../../test/fixedClock';
import { describeFutureClampContract } from '../../test/futureClampHelpers';

const ZONE = 'Europe/London';
const NOW = Date.UTC(2026, 5, 15, 9, 0); // 10:00 London (BST)

withFixedClock(NOW);

function baseTarget(): LoggerTarget {
  return {
    slotId: 's1',
    medId: 'a',
    scheduledInstant: NOW,
    normalDose: 100,
  };
}

beforeEach(() => {
  useStore.setState({
    hydrated: true,
    medications: [med({ id: 'a', name: 'Lamotrigine', unit: 'mg' })],
    slots: [],
    doseLog: [],
    settings: settings({ zone: ZONE }),
  });
});

describeFutureClampContract(
  'DoseLogger',
  (actualInstant) => {
    const target: LoggerTarget = {
      ...baseTarget(),
      ...(actualInstant != null ? { actualInstant } : {}),
    };
    render(<DoseLogger target={target} onClose={() => {}} />);
  },
  NOW,
  ZONE,
);
