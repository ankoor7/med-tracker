// Stage 18 FR-18.10: the group-logger's per-row and submit-button copy used to
// say "over-cap" unconditionally, even for a min-interval ("too soon") breach.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { GroupLogger, type GroupLoggerTarget } from './GroupLogger';
import { useStore } from '../../store/store';
import { med, settings, logEntry } from '../../test/fixtures';
import { withFixedClock } from '../../test/fixedClock';
import { describeFutureClampContract } from '../../test/futureClampHelpers';

const ZONE = 'Europe/London';
const NOW = Date.UTC(2026, 5, 15, 9, 0); // 10:00 London (BST)

withFixedClock(NOW);

function baseTarget(): GroupLoggerTarget {
  return {
    slotId: 's1',
    scheduledInstant: NOW,
    label: 'Morning',
    members: [
      { medId: 'a', normalDose: 100 },
      { medId: 'b', normalDose: 200 },
    ],
  };
}

beforeEach(() => {
  useStore.setState({
    hydrated: true,
    medications: [
      med({
        id: 'a',
        name: 'Lamotrigine',
        unit: 'mg',
        guardrails: { maxSingleDose: 50, maxDailyDose: null, minIntervalHours: null },
      }),
      med({
        id: 'b',
        name: 'Levetiracetam',
        unit: 'mg',
        guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: null },
      }),
    ],
    doseLog: [],
    settings: settings({ zone: ZONE }),
  });
});

describe('GroupLogger — breach-kind-aware acknowledgement copy (FR-18.10)', () => {
  it('labels an over-cap row breach "over-cap", not a generic or wrong label', () => {
    render(<GroupLogger target={baseTarget()} onClose={() => {}} />);
    // Lamotrigine's normal dose (100) already exceeds its maxSingleDose (50).
    expect(screen.getByText(/log this over-cap dose anyway/i)).toBeInTheDocument();
  });

  it('labels a min-interval row breach "too-soon", NEVER "over-cap"', () => {
    useStore.setState({
      medications: [
        med({
          id: 'a',
          name: 'Lamotrigine',
          unit: 'mg',
          guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: 6 },
        }),
        med({ id: 'b', name: 'Levetiracetam', unit: 'mg' }),
      ],
      doseLog: [
        logEntry({
          id: 'prior',
          slotId: 'earlier-slot',
          medId: 'a',
          scheduledInstant: NOW - 3600_000,
          actualInstant: NOW - 3600_000,
          dose: 100,
          status: 'taken',
          zone: ZONE,
        }),
      ],
    });
    render(<GroupLogger target={baseTarget()} onClose={() => {}} />);

    expect(screen.getByText(/log this too-soon dose anyway/i)).toBeInTheDocument();
    expect(screen.queryByText(/log this over-cap dose anyway/i)).not.toBeInTheDocument();
  });

  it('the group submit button falls back to a safe generic label when included members have mixed breach kinds', () => {
    useStore.setState({
      medications: [
        med({
          id: 'a',
          name: 'Lamotrigine',
          unit: 'mg',
          guardrails: { maxSingleDose: 50, maxDailyDose: null, minIntervalHours: null }, // over-cap
        }),
        med({
          id: 'b',
          name: 'Levetiracetam',
          unit: 'mg',
          guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: 6 }, // too-soon
        }),
      ],
      doseLog: [
        logEntry({
          id: 'prior-b',
          slotId: 'earlier-slot',
          medId: 'b',
          scheduledInstant: NOW - 3600_000,
          actualInstant: NOW - 3600_000,
          dose: 200,
          status: 'taken',
          zone: ZONE,
        }),
      ],
    });
    render(<GroupLogger target={baseTarget()} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /log group anyway/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /log over-cap group/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /log too-soon group/i })).not.toBeInTheDocument();
  });

  it('the group submit button names an all-over-cap breach specifically', () => {
    render(<GroupLogger target={baseTarget()} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /log over-cap group/i })).toBeInTheDocument();
  });
});

// Stage 18 FR-18.9(b)/AC9: a future dragged time must never be silently
// swapped for "now" — it's clamped to now AND the swap is explained. Before
// this fix, `Math.min(target.actualInstant ?? now, now)` at mount (and the
// same clamp inside `setWhen`) discarded a future dragged time with no trace.
// The four cases live once, in `describeFutureClampContract`, shared with
// DoseLogger.test.tsx.
describeFutureClampContract(
  'GroupLogger',
  (actualInstant) => {
    const target: GroupLoggerTarget = {
      ...baseTarget(),
      ...(actualInstant != null ? { actualInstant } : {}),
    };
    render(<GroupLogger target={target} onClose={() => {}} />);
  },
  NOW,
);
