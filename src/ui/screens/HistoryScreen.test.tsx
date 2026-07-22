import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { HistoryScreen } from './HistoryScreen';
import { useStore } from '../../store/store';
import { RemindersProvider } from '../../reminders/context';
import { med, settings, slot, logEntry } from '../../test/fixtures';
import { withFixedClock } from '../../test/fixedClock';
import {
  openDeleteConfirm,
  cancelDialog,
  confirmDeleteDose,
  openEditDialog,
  setDoseValue,
} from '../../test/doseLogDialogHelpers';

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

withFixedClock(NOW);
beforeEach(() => seed());

function renderHistory() {
  render(
    <RemindersProvider>
      <HistoryScreen />
    </RemindersProvider>,
  );
}

/**
 * The dose-log row for the seeded entry. 'Lamotrigine' also appears as an
 * <option> in the medication filter dropdown, so the row is located by its
 * dose amount, which only the log row carries.
 */
function doseLogRow(): HTMLElement {
  return screen.getByText('100mg').closest<HTMLElement>('li')!;
}

describe('HistoryScreen — no blood-level chart (FR-18.11, AC12)', () => {
  it('renders no "Predicted blood level" heading or related copy', () => {
    renderHistory();

    expect(screen.queryByText(/predicted blood level/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pharmacology extension/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/levelSeries/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /predicted blood level/i })).not.toBeInTheDocument();
  });

  it('still renders the adherence chart, unaffected by the removal', () => {
    renderHistory();
    expect(
      screen.getByRole('img', { name: /adherence over the last \d+ days/i }),
    ).toBeInTheDocument();
  });
});

describe('HistoryScreen — dose correction (Stage 18 FR-18.2)', () => {
  it('a logged dose can be edited from History, re-running guardrails (AC5)', () => {
    renderHistory();

    const dialog = openEditDialog(doseLogRow());
    expect(dialog).toHaveTextContent(/edit lamotrigine dose/i);
    setDoseValue(dialog, '120');
    fireEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

    const log = useStore.getState().doseLog.filter((e) => !e.deleted);
    expect(log).toHaveLength(1);
    expect(log[0]!.id).toBe('l1');
    expect(log[0]!.dose).toBe(120);
    expect(log[0]!.adjusted).toBe(true);
  });

  it('a logged dose can be deleted from History; cancelling first performs no mutation (AC5)', () => {
    renderHistory();

    const dialog = openDeleteConfirm(doseLogRow());
    expect(dialog).toHaveTextContent(/delete this logged dose/i);
    cancelDialog(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useStore.getState().doseLog.filter((e) => !e.deleted)).toHaveLength(1);

    confirmDeleteDose(openDeleteConfirm(doseLogRow()));

    const log = useStore.getState().doseLog;
    expect(log).toHaveLength(1); // tombstoned, not hard-deleted (retained at storage layer)
    expect(log[0]!.deleted).toBe(true);
    // The dose-log list (not the medication filter dropdown) no longer shows it.
    expect(screen.getByText('No doses match the current filter.')).toBeInTheDocument();
  });
});
