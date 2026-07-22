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
import type { DoseLogEntry } from '../../core/types';

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

describe('HistoryScreen — lateness-aware adherence (Stage 18 FR-18.4)', () => {
  /**
   * One medication ('a') in one slot ('s1') with a single dose-log entry —
   * `entryOverrides` supplies whatever the test cares about (a delayed
   * `actualInstant`, `status: 'skipped'`, ...). Shared by the late- and
   * skipped-dose tests below, which otherwise only differ in that entry.
   */
  function seedDoseLog(entryOverrides: Partial<DoseLogEntry> & { scheduledInstant: number }) {
    useStore.setState({
      hydrated: true,
      medications: [med({ id: 'a', name: 'Lamotrigine', unit: 'mg', adjustWhenLate: true })],
      slots: [
        slot({ id: 's1', time: '08:00', label: 'Morning', items: [{ medId: 'a', dose: 100 }] }),
      ],
      doseLog: [
        logEntry({
          id: 'l1',
          slotId: 's1',
          medId: 'a',
          dose: 100,
          status: 'taken',
          ...entryOverrides,
        }),
      ],
      settings: settings({ zone: ZONE, adherenceWindowDays: 1 }),
    });
  }

  function seedLateDose(delayMinutes: number) {
    const scheduledInstant = NOW - 2 * 3600_000;
    seedDoseLog({ scheduledInstant, actualInstant: scheduledInstant + delayMinutes * 60_000 });
  }

  // Back-compat: a settings record persisted before FR-18.4 (this field never
  // existed) has no `onTimeWindowMinutes` key at all — not `undefined`, not
  // `0`, genuinely absent, as a raw object loaded from storage would be. The
  // screen must still read it as the documented default (`core/adherence.ts`
  // `DEFAULT_ON_TIME_WINDOW_MINUTES`), not `0`/`NaN`.
  it('reads a pre-FR-18.4 settings record (no onTimeWindowMinutes key) as the default window', () => {
    seedLateDose(90);
    const { zone, adherenceWindowDays, missedDayThreshold, updatedAt } =
      useStore.getState().settings;
    useStore.setState({ settings: { zone, adherenceWindowDays, missedDayThreshold, updatedAt } });
    renderHistory();
    expect(screen.getByLabelText('On-time window minutes')).toHaveValue(60);
    // 90m late is still outside a 60m default window — classified as late,
    // proving the fallback actually feeds adherence scoring, not just the input.
    expect(screen.getByText(/0 on time · 1 late/)).toBeInTheDocument();
  });

  it('reports a dose outside the default window as late, distinct from on time (AC4)', () => {
    seedLateDose(90); // default window is 60 minutes
    renderHistory();
    expect(screen.getByText(/0 on time · 1 late · 0 missed/)).toBeInTheDocument();
  });

  it('widening the on-time window reclassifies the same dose as on time', () => {
    seedLateDose(90);
    renderHistory();
    expect(screen.getByText(/0 on time · 1 late/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('On-time window minutes'), {
      target: { value: '120' },
    });
    expect(screen.getByText(/1 on time · 0 late/)).toBeInTheDocument();
  });

  it('a skipped dose is called out separately and does not read as missed', () => {
    const scheduledInstant = NOW - 3600_000;
    seedDoseLog({ scheduledInstant, actualInstant: scheduledInstant, dose: 0, status: 'skipped' });
    renderHistory();
    expect(
      screen.getByText(/0 on time · 0 late · 0 missed · 0 expected · 1 skipped/),
    ).toBeInTheDocument();
    // The dose-log row itself reads "Skipped", not a dose amount, and offers no
    // dose editor.
    const row = screen.getByText('Skipped').closest<HTMLElement>('li')!;
    expect(within(row).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});

// Stage 18 FR-18.6 — assumed vs logged doses must be distinguishable, and any
// adherence figure derived partly from assumption must say so, next to the
// number rather than only in Settings.
describe('HistoryScreen — assumed vs logged must be disclosed (Stage 18 FR-18.6)', () => {
  function seedUnloggedWindow(assumeTakenOnTime: boolean) {
    useStore.setState({
      hydrated: true,
      medications: [med({ id: 'a', name: 'Lamotrigine', unit: 'mg', adjustWhenLate: true })],
      slots: [
        slot({ id: 's1', time: '08:00', label: 'Morning', items: [{ medId: 'a', dose: 100 }] }),
      ],
      doseLog: [], // the exact fresh-install scenario: nothing has ever been logged
      settings: settings({ zone: ZONE, adherenceWindowDays: 1, assumeTakenOnTime }),
    });
  }

  const countsLine = () => screen.getByTestId('adherence-counts');

  it('a figure entirely from assumption discloses the caveat next to the number', () => {
    seedUnloggedWindow(true);
    renderHistory();
    expect(countsLine()).toHaveTextContent('1 on time (1 assumed) · 0 late · 0 missed');
    const basis = screen.getByTestId('assumed-basis-note');
    expect(basis).toHaveTextContent('1 of the 1 on-time doses above are assumed');
    expect(basis).toHaveTextContent('not confirmed by you');
  });

  it('a figure derived entirely from real logs carries no assumed caveat', () => {
    // A single-day window with nothing left unaccounted for by a real log —
    // no room for the assume-on-time policy to fill anything in.
    seedUnloggedWindow(true);
    useStore.setState({
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
    });
    renderHistory();
    expect(countsLine()).toHaveTextContent('1 on time · 0 late · 0 missed');
    expect(countsLine()).not.toHaveTextContent('assumed');
    expect(screen.queryByTestId('assumed-basis-note')).not.toBeInTheDocument();
  });

  it('turning assumeTakenOnTime off is reversible and returns to the same disclosed figure', () => {
    seedUnloggedWindow(true);
    renderHistory();
    expect(countsLine()).toHaveTextContent('1 on time (1 assumed)');

    fireEvent.click(screen.getByLabelText('Assume doses taken on time'));
    // Off: the same unlogged dose now reads as missed, not assumed — no caveat,
    // because there is no longer any assumption in the figure.
    expect(countsLine()).toHaveTextContent('0 on time · 0 late · 1 missed');
    expect(screen.queryByTestId('assumed-basis-note')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Assume doses taken on time'));
    // Back on: identical to the original figure — nothing in the dose log
    // changed at any point, only how it's summarised.
    expect(countsLine()).toHaveTextContent('1 on time (1 assumed)');
    const basis = screen.getByTestId('assumed-basis-note');
    expect(basis).toHaveTextContent('1 of the 1 on-time doses above are assumed');
  });

  it('the toggle copy explains the swing is an artefact of the setting, not new information about missed doses', () => {
    renderHistory();
    expect(screen.getByText(/shown distinctly from ones you actually logged/i)).toBeInTheDocument();
    expect(
      screen.getByText(/every unlogged past dose will now show as missed instead of assumed/i),
    ).toBeInTheDocument();
  });
});
