import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MedsScreen } from './MedsScreen';
import { useStore } from '../../store/store';
import { med, settings, slot, logEntry } from '../../test/fixtures';
import { openDeleteConfirm } from '../../test/doseLogDialogHelpers';

/** The medication card for `name`, e.g. as returned by the ColorDot/name row. */
function medRow(name: string): HTMLElement {
  return screen.getByText(name).closest<HTMLElement>('[class*="rounded-2xl"]')!;
}

const ZONE = 'Europe/London';
const NOW = Date.UTC(2026, 6, 20, 9, 0);

function seed() {
  useStore.setState({
    hydrated: true,
    medications: [
      med({ id: 'a', name: 'Lamotrigine', unit: 'mg', active: true }),
      med({ id: 'b', name: 'Levetiracetam', unit: 'mg', active: false }),
    ],
    slots: [slot({ id: 's1', time: '08:00', items: [{ medId: 'a', dose: 100 }] })],
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
    regimenChanges: [],
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

// Stage 18 FR-18.5 — destructive actions on the medication card.
describe('MedsScreen — destructive actions (FR-18.5)', () => {
  it('Delete requires explicit confirmation naming the medication (AC7)', () => {
    render(<MedsScreen />);
    const dialog = openDeleteConfirm(medRow('Lamotrigine'));

    expect(dialog).toHaveTextContent(/delete lamotrigine/i);
    // Reassures the user their dose history is retained (it genuinely is).
    expect(dialog).toHaveTextContent(/dose history is retained/i);
  });

  it('cancelling the delete confirmation performs no mutation (AC7)', () => {
    render(<MedsScreen />);
    openDeleteConfirm(medRow('Lamotrigine'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useStore.getState().medications.find((m) => m.id === 'a')?.deleted).toBeFalsy();
  });

  it('confirming Delete tombstones the medication; its dose-log entries remain present and correctly named (AC7)', () => {
    render(<MedsScreen />);
    openDeleteConfirm(medRow('Lamotrigine'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete medication' }));

    const deletedMed = useStore.getState().medications.find((m) => m.id === 'a');
    expect(deletedMed?.deleted).toBe(true);

    // Storage-layer guarantee under test: dose history is retained, not
    // destroyed, and still resolves to the medication's real name.
    const entry = useStore.getState().doseLog.find((e) => e.id === 'l1');
    expect(entry?.deleted).toBeFalsy();
    expect(entry?.medId).toBe('a');
    expect(useStore.getState().medications.find((m) => m.id === 'a')?.name).toBe('Lamotrigine');
  });

  it('"Stop taking" is offered before Delete and is visually distinct, for the soft (active: false) path', () => {
    render(<MedsScreen />);
    const row = medRow('Lamotrigine');
    const buttons = within(row).getAllByRole('button');
    const labels = buttons.map((b) => b.textContent);
    expect(labels).toContain('Stop taking');
    expect(labels.indexOf('Stop taking')).toBeLessThan(labels.indexOf('Delete'));

    fireEvent.click(within(row).getByRole('button', { name: 'Stop taking' }));

    // No confirmation needed for the safe, reversible path — takes effect
    // immediately as a soft `active: false`, not a tombstone.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const updated = useStore.getState().medications.find((m) => m.id === 'a')!;
    expect(updated.active).toBe(false);
    expect(updated.deleted).toBeFalsy();
  });

  it('an inactive medication is not offered "Stop taking" again', () => {
    render(<MedsScreen />);
    const row = medRow('Levetiracetam');
    expect(within(row).queryByRole('button', { name: 'Stop taking' })).not.toBeInTheDocument();
  });
});
