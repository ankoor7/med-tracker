import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TodayScreen } from './TodayScreen';
import { useStore } from '../../store/store';
import { med, settings, slot } from '../../test/fixtures';
import { withFixedClock } from '../../test/fixedClock';
import {
  submitLogDose,
  openDeleteConfirm,
  cancelDialog,
  confirmDeleteDose,
  openEditDialog,
  setDoseValue,
} from '../../test/doseLogDialogHelpers';

const ZONE = 'Europe/London';
// Fixed clock: 2026-06-15 10:00 London (BST) == 09:00 UTC. Slots earlier than
// this are past/actionable.
const NOW = Date.UTC(2026, 5, 15, 9, 0);

function seed(
  meds = [med({ id: 'a', name: 'Lamotrigine', unit: 'mg', adjustWhenLate: true })],
  slots = [slot({ id: 's1', time: '08:00', label: 'Morning', items: [{ medId: 'a', dose: 100 }] })],
) {
  useStore.setState({
    hydrated: true,
    medications: meds,
    slots,
    doseLog: [],
    // These scenarios exercise the explicit log/missed/due flow, so opt out of the
    // assume-taken-on-time policy (default on); its own behaviour is covered below.
    settings: settings({ zone: ZONE, assumeTakenOnTime: false }),
  });
}

withFixedClock(NOW);
beforeEach(() => seed());

const activeLog = () => useStore.getState().doseLog.filter((e) => !e.deleted);

describe('TodayScreen', () => {
  it('take-group logs all items at normal dose, time≈now (AC2)', () => {
    render(<TodayScreen />);
    fireEvent.click(screen.getByRole('button', { name: /take group/i }));

    const log = activeLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.dose).toBe(100);
    expect(log[0]!.status).toBe('taken');
    expect(log[0]!.adjusted).toBe(false);
    expect(Math.abs(log[0]!.actualInstant - NOW)).toBeLessThan(1000);
  });

  it('single late log with a different dose is marked adjusted (AC3)', () => {
    render(<TodayScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Dose'), { target: { value: '150' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /log dose/i }));

    const log = activeLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.dose).toBe(150);
    expect(log[0]!.adjusted).toBe(true);
    expect(log[0]!.zone).toBe(ZONE);
  });

  it('over-cap dose requires confirmation and flags the entry (AC4)', () => {
    seed([
      med({
        id: 'a',
        name: 'Lamotrigine',
        unit: 'mg',
        guardrails: { maxSingleDose: 100, maxDailyDose: null, minIntervalHours: null },
      }),
    ]);
    render(<TodayScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Dose'), { target: { value: '150' } });

    const logBtn = within(dialog).getByRole('button', { name: /log over-cap dose/i });
    expect(logBtn).toBeDisabled();
    expect(within(dialog).getByText(/max single dose/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /understand and want to log/i }));
    expect(logBtn).toBeEnabled();
    fireEvent.click(logBtn);

    const log = activeLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.warnings.length).toBeGreaterThan(0);
  });

  // Stage 18 FR-18.10: the ack button used to read "Log over-cap dose" even
  // for a too-soon (min-interval) breach, which misnames the actual violation.
  it('a min-interval (too-soon) breach labels the ack button "Log too-soon dose", NOT "over-cap" (FR-18.10)', () => {
    seed(
      [
        med({
          id: 'a',
          name: 'Lamotrigine',
          unit: 'mg',
          guardrails: { maxSingleDose: null, maxDailyDose: null, minIntervalHours: 6 },
        }),
      ],
      [slot({ id: 's1', time: '08:00', label: 'Morning', items: [{ medId: 'a', dose: 100 }] })],
    );
    // A dose already taken 1h ago — below the 6h minimum interval. Given a
    // different `slotId` so it isn't mistaken for the occurrence being
    // tested below (occurrence matching is slotId+medId+time based).
    useStore.setState({
      doseLog: [
        {
          id: 'prior',
          slotId: 'earlier-slot',
          medId: 'a',
          scheduledInstant: NOW - 3600_000,
          actualInstant: NOW - 3600_000,
          dose: 100,
          unit: 'mg',
          zone: ZONE,
          status: 'taken',
          adjusted: false,
          warnings: [],
          updatedAt: NOW - 3600_000,
        },
      ],
    });
    render(<TodayScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/min interval/i)).toBeInTheDocument();

    const logBtn = within(dialog).getByRole('button', { name: /log too-soon dose/i });
    expect(logBtn).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /log over-cap dose/i })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /understand and want to log/i }));
    fireEvent.click(logBtn);

    const log = activeLog();
    expect(log).toHaveLength(2);
  });

  it('logging an adjusted dose can set a one-time override for the next dose (Stage 12)', () => {
    seed(
      [med({ id: 'a', name: 'Lamotrigine', unit: 'mg', adjustWhenLate: true })],
      [
        slot({ id: 'am', time: '08:00', label: 'Morning', items: [{ medId: 'a', dose: 100 }] }),
        slot({ id: 'pm', time: '20:00', label: 'Evening', items: [{ medId: 'a', dose: 100 }] }),
      ],
    );
    render(<TodayScreen />);

    // The 08:00 slot is first (sorted by time); log it late at an adjusted amount.
    fireEvent.click(screen.getAllByRole('button', { name: 'Log' })[0]!);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Dose'), { target: { value: '60' } });

    // The adjust-next-dose section appears; enable it and set the next amount.
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: /adjust next lamotrigine dose/i }),
    );
    fireEvent.change(within(dialog).getByLabelText('Next dose'), { target: { value: '80' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /log dose/i }));

    const overrides = useStore.getState().doseOverrides.filter((o) => !o.deleted);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.slotId).toBe('pm');
    expect(overrides[0]!.dose).toBe(80);

    // Today's evening row now shows the override amount, flagged adjusted.
    const eveningRow = screen.getAllByText('Lamotrigine')[1]!.closest('li')!;
    expect(within(eveningRow).getByText('adjusted')).toBeInTheDocument();
    expect(within(eveningRow).getByText(/80mg/)).toBeInTheDocument();
  });

  it('partial group: taking one item leaves the other still due (AC5)', () => {
    seed(
      [
        med({ id: 'a', name: 'MedA', adjustWhenLate: false }),
        med({ id: 'b', name: 'MedB', adjustWhenLate: false }),
      ],
      [
        slot({
          id: 's1',
          time: '08:00',
          items: [
            { medId: 'a', dose: 10 },
            { medId: 'b', dose: 20 },
          ],
        }),
      ],
    );
    render(<TodayScreen />);

    const rowA = screen.getByText('MedA').closest('li')!;
    fireEvent.click(within(rowA).getByRole('button', { name: 'Log' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /log dose/i }));

    const rowAAfter = screen.getByText('MedA').closest('li')!;
    expect(within(rowAAfter).getByText('Taken')).toBeInTheDocument();
    const rowB = screen.getByText('MedB').closest('li')!;
    expect(within(rowB).getByRole('button', { name: 'Log' })).toBeInTheDocument();
  });

  describe('assume taken on time (default on)', () => {
    function seedAssumed() {
      useStore.setState({
        hydrated: true,
        medications: [med({ id: 'a', name: 'Lamotrigine', unit: 'mg', adjustWhenLate: true })],
        slots: [
          slot({ id: 's1', time: '08:00', label: 'Morning', items: [{ medId: 'a', dose: 100 }] }),
        ],
        doseLog: [],
        settings: settings({ zone: ZONE, assumeTakenOnTime: true }),
      });
    }

    it('a past, unlogged dose reads as "On time" with an Edit affordance, not Missed', () => {
      seedAssumed();
      render(<TodayScreen />);

      const row = screen.getByText('Lamotrigine').closest('li')!;
      expect(within(row).getByText('On time')).toBeInTheDocument();
      expect(within(row).queryByText('Missed')).not.toBeInTheDocument();
      // No real entry exists yet — it is assumed, not logged.
      expect(activeLog()).toHaveLength(0);
      // It stays editable so the user can correct it to a late/different dose.
      expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });

    it('editing an assumed dose writes a real log entry (the only way it becomes late)', () => {
      seedAssumed();
      render(<TodayScreen />);

      const row = screen.getByText('Lamotrigine').closest('li')!;
      fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: /log dose/i }),
      );

      // It is now an explicitly-logged dose: a real entry, and the badge flips
      // from "On time" (assumed) to "Taken".
      expect(activeLog().map((e) => e.status)).toEqual(['taken']);
      const after = screen.getByText('Lamotrigine').closest('li')!;
      expect(within(after).getByText('Taken')).toBeInTheDocument();
      expect(within(after).queryByText('On time')).not.toBeInTheDocument();
    });

    // Stage 18 FR-18.6 — the exact defect: a fresh install with an empty dose
    // log showed "5 of 5 doses taken" with no disclosure that every one of
    // those 5 was an assumption, not a real record.
    it('a fresh install with an empty log discloses the headline count as assumed, not silently 100%', () => {
      seed(
        [
          med({ id: 'a', name: 'Lamotrigine', adjustWhenLate: true }),
          med({ id: 'b', name: 'Levetiracetam', adjustWhenLate: true }),
        ],
        [
          slot({ id: 's1', time: '06:00', items: [{ medId: 'a', dose: 100 }] }),
          slot({ id: 's2', time: '07:00', items: [{ medId: 'b', dose: 100 }] }),
        ],
      );
      useStore.setState({ settings: settings({ zone: ZONE, assumeTakenOnTime: true }) });
      render(<TodayScreen />);

      // The ring headline still reads 2/2 taken, but its accessible name
      // discloses that both are assumed, not logged...
      expect(
        screen.getByRole('img', { name: /2 of 2 doses taken today, including 2 assumed/i }),
      ).toBeInTheDocument();
      // ...and the composition is disclosed visibly right next to it, not buried.
      const note = screen.getByTestId('assumed-composition-note');
      expect(note).toHaveTextContent('2 of 2 assumed taken on time, not logged');
      expect(note).toHaveTextContent('0 confirmed by you');
      expect(activeLog()).toHaveLength(0); // nothing was actually logged
    });

    it('once a dose is genuinely logged, the assumed count only covers what remains unlogged', () => {
      seedAssumed();
      render(<TodayScreen />);
      fireEvent.click(
        within(screen.getByText('Lamotrigine').closest('li')!).getByRole('button', {
          name: 'Edit',
        }),
      );
      submitLogDose();

      // The single occurrence is now genuinely logged — no assumption left to
      // disclose, so the composition note must not render a misleading caveat.
      expect(screen.queryByTestId('assumed-composition-note')).not.toBeInTheDocument();
    });
  });

  describe('dose correction (Stage 18 FR-18.2)', () => {
    // Log the single Lamotrigine dose via the normal "Log" flow, returning the
    // now-Taken row for the follow-on edit/delete interaction.
    function logAndGetRow(): HTMLElement {
      render(<TodayScreen />);
      fireEvent.click(screen.getByRole('button', { name: 'Log' }));
      submitLogDose();
      expect(activeLog()).toHaveLength(1);
      return screen.getByText('Lamotrigine').closest<HTMLElement>('li')!;
    }

    it('a genuinely-logged dose is editable in place and re-runs guardrails (AC5)', () => {
      seed([
        med({
          id: 'a',
          name: 'Lamotrigine',
          unit: 'mg',
          guardrails: { maxSingleDose: 150, maxDailyDose: null, minIntervalHours: null },
        }),
      ]);
      const row = logAndGetRow();
      const originalId = activeLog()[0]!.id;

      // A real (non-assumed) taken dose now offers Edit — open it.
      const dialog = openEditDialog(row);
      expect(dialog).toHaveTextContent(/edit lamotrigine dose/i);

      // Correcting to an over-cap amount re-runs the shared guardrail check
      // and gates the save behind the same acknowledgement pattern as a fresh log.
      setDoseValue(dialog, '200');
      const saveBtn = within(dialog).getByRole('button', { name: /save over-cap dose/i });
      expect(saveBtn).toBeDisabled();
      fireEvent.click(
        within(dialog).getByRole('checkbox', { name: /understand and want to log/i }),
      );
      expect(saveBtn).toBeEnabled();
      fireEvent.click(saveBtn);

      // Edits the existing entry — no second entry is created.
      const log = activeLog();
      expect(log).toHaveLength(1);
      expect(log[0]!.id).toBe(originalId);
      expect(log[0]!.dose).toBe(200);
      expect(log[0]!.warnings.some((w) => /max single dose/i.test(w))).toBe(true);
    });

    it('a genuinely-logged dose can be deleted from Today, gated by confirmation (AC5)', () => {
      const row = logAndGetRow();

      const dialog = openDeleteConfirm(row);
      expect(dialog).toHaveTextContent(/delete this logged dose/i);

      // Cancelling performs no mutation.
      cancelDialog(dialog);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(activeLog()).toHaveLength(1);

      // Confirming tombstones the entry — it stops counting toward adherence,
      // reflected here by the occurrence no longer reading "Taken".
      confirmDeleteDose(openDeleteConfirm(row));
      expect(activeLog()).toHaveLength(0);
      expect(useStore.getState().doseLog).toHaveLength(1); // tombstoned, not hard-deleted
      const after = screen.getByText('Lamotrigine').closest<HTMLElement>('li')!;
      expect(within(after).queryByText('Taken')).not.toBeInTheDocument();
    });
  });

  describe('skip dose (Stage 18 FR-18.3)', () => {
    it('marks a dose skipped from Today, reporting it distinctly from taken and missed', () => {
      render(<TodayScreen />);
      const row = screen.getByText('Lamotrigine').closest<HTMLElement>('li')!;
      // The past, unlogged dose starts out "Missed" (assumeTakenOnTime is off
      // in `seed()`).
      expect(within(row).getByText('Missed')).toBeInTheDocument();

      fireEvent.click(within(row).getByRole('button', { name: 'Skip' }));
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent(/skip lamotrigine/i);
      fireEvent.click(within(dialog).getByRole('button', { name: /mark skipped/i }));

      const after = screen.getByText('Lamotrigine').closest<HTMLElement>('li')!;
      expect(within(after).getByText('Skipped')).toBeInTheDocument();
      expect(within(after).queryByText('Missed')).not.toBeInTheDocument();
      expect(within(after).queryByText('Taken')).not.toBeInTheDocument();

      const log = activeLog();
      expect(log).toHaveLength(1);
      expect(log[0]!.status).toBe('skipped');
      expect(log[0]!.dose).toBe(0);
    });

    it('records an optional skip reason', () => {
      render(<TodayScreen />);
      const row = screen.getByText('Lamotrigine').closest<HTMLElement>('li')!;
      fireEvent.click(within(row).getByRole('button', { name: 'Skip' }));

      const dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Skip reason'), {
        target: { value: 'GP advised skipping this dose' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: /mark skipped/i }));

      expect(activeLog()[0]!.skipReason).toBe('GP advised skipping this dose');
    });

    it('a skipped dose can be deleted, reverting the occurrence to its prior state', () => {
      render(<TodayScreen />);
      const row = screen.getByText('Lamotrigine').closest<HTMLElement>('li')!;
      fireEvent.click(within(row).getByRole('button', { name: 'Skip' }));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: /mark skipped/i }),
      );

      const skippedRow = screen.getByText('Lamotrigine').closest<HTMLElement>('li')!;
      // A skip has no dose amount to correct, so there is no Edit affordance —
      // only Delete.
      expect(within(skippedRow).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      confirmDeleteDose(openDeleteConfirm(skippedRow));

      expect(activeLog()).toHaveLength(0);
      const after = screen.getByText('Lamotrigine').closest<HTMLElement>('li')!;
      expect(within(after).queryByText('Skipped')).not.toBeInTheDocument();
      expect(within(after).getByText('Missed')).toBeInTheDocument();
    });

    it('does not offer Skip once a dose is already taken', () => {
      render(<TodayScreen />);
      fireEvent.click(screen.getByRole('button', { name: 'Log' }));
      submitLogDose();
      const row = screen.getByText('Lamotrigine').closest<HTMLElement>('li')!;
      expect(within(row).queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    });
  });
});
