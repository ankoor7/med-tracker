import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryScreen } from './HistoryScreen';
import { useStore } from '../../store/store';
import { RemindersProvider } from '../../reminders/context';
import { med, settings, slot, logEntry } from '../../test/fixtures';

const ZONE = 'Europe/London';
const NOW = Date.UTC(2026, 6, 20, 9, 0);

function seed() {
  useStore.setState({
    hydrated: true,
    medications: [med({ id: 'a', name: 'Lamotrigine', unit: 'mg' })],
    slots: [
      slot({ id: 's1', time: '08:00', label: 'Morning', items: [{ medId: 'a', dose: 100 }] }),
    ],
    doseLog: [
      logEntry({
        id: 'l1',
        slotId: 's1',
        medId: 'a',
        scheduledInstant: NOW - 3600_000,
        actualInstant: NOW - 3600_000,
        dose: 100,
        status: 'taken',
      }),
    ],
    settings: settings({ zone: ZONE }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  seed();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HistoryScreen — no blood-level chart (FR-18.11, AC12)', () => {
  it('renders no "Predicted blood level" heading or related copy', () => {
    render(
      <RemindersProvider>
        <HistoryScreen />
      </RemindersProvider>,
    );

    expect(screen.queryByText(/predicted blood level/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pharmacology extension/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/levelSeries/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /predicted blood level/i })).not.toBeInTheDocument();
  });

  it('still renders the adherence chart, unaffected by the removal', () => {
    render(
      <RemindersProvider>
        <HistoryScreen />
      </RemindersProvider>,
    );
    expect(
      screen.getByRole('img', { name: /adherence over the last \d+ days/i }),
    ).toBeInTheDocument();
  });
});
