import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayScreen } from './TodayScreen';
import { useStore } from '../../store/store';
import { med, settings, slot } from '../../test/fixtures';

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

    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(logBtn).toBeEnabled();
    fireEvent.click(logBtn);

    const log = activeLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.warnings.length).toBeGreaterThan(0);
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
});
