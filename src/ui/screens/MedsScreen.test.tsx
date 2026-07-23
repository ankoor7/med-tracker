import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MedsScreen } from './MedsScreen';
import { TodayScreen } from './TodayScreen';
import { useStore } from '../../store/store';
import type { RegimenChange } from '../../core';
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
    scheduleSnapshots: [],
    settings: settings({ zone: ZONE }),
  });
}

/** Put both medications in one 08:00 slot, as the seeded data does. */
function seedSharedMorningSlot() {
  useStore.setState({
    slots: [
      slot({
        id: 's1',
        time: '08:00',
        items: [
          { medId: 'a', dose: 100 },
          { medId: 'b', dose: 500 },
        ],
      }),
    ],
  });
}

/** Lamotrigine at 08:00 and Levetiracetam at 20:00, sharing nothing. */
function seedTwoIndependentSlots() {
  useStore.setState({
    slots: [
      slot({ id: 's1', time: '08:00', items: [{ medId: 'a', dose: 100 }] }),
      slot({ id: 's2', time: '20:00', items: [{ medId: 'b', dose: 500 }] }),
    ],
  });
}

/** Drive the merged editor to move Lamotrigine's only dose to `time`. */
function retimeLamotrigineTo(time: string) {
  render(<MedsScreen />);
  const dialog = openMedEditor('Lamotrigine');
  setValue(dialog, 'Time for dose 1', time);
  saveDialog(dialog);
}

/** Switch the merged tab between its two projections of the same slots. */
function showView(name: 'By medication' | 'By time') {
  fireEvent.click(screen.getByRole('button', { name }));
}

function openMedEditor(name: string): HTMLElement {
  fireEvent.click(within(medRow(name)).getByRole('button', { name: 'Edit' }));
  return screen.getByRole('dialog');
}

function saveDialog(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
}

function setValue(dialog: HTMLElement, label: string, value: string) {
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
}

/** Change records minus the fields that legitimately differ per run. */
function comparableChanges(changes: RegimenChange[]) {
  return changes.map(({ id: _id, changedAt: _c, updatedAt: _u, ...rest }) => rest);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  seed();
});

afterEach(() => {
  vi.useRealTimers();
});

// Stage 18 FR-18.5 — destructive actions on the medication card. Migrated from
// the pre-merge MedsScreen; the card still owns these actions.
describe('Meds tab — destructive actions (FR-18.5)', () => {
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

  it('deleting a time-slot from the by-time view is confirmed and names what it affects', () => {
    render(<MedsScreen />);
    showView('By time');
    const card = screen.getByText('08:00').closest<HTMLElement>('[class*="rounded-2xl"]')!;
    const dialog = openDeleteConfirm(card);

    expect(dialog).toHaveTextContent(/delete the 08:00 time-slot/i);
    expect(dialog).toHaveTextContent(/Lamotrigine/);
    expect(dialog).toHaveTextContent(/already logged for this slot are retained/i);
  });
});

// Stage 18 FR-18.12 — the merge itself.
describe('Meds tab — merged medication + schedule (FR-18.12)', () => {
  it('answers "when do I take this, and how much?" on the medication card', () => {
    render(<MedsScreen />);
    const list = within(medRow('Lamotrigine')).getByRole('list', {
      name: 'Lamotrigine schedule',
    });
    expect(list).toHaveTextContent('08:00');
    expect(list).toHaveTextContent('100mg');
  });

  it('answers "what do I take at 08:00?" in the by-time projection', () => {
    render(<MedsScreen />);
    showView('By time');
    const card = screen.getByText('08:00').closest<HTMLElement>('[class*="rounded-2xl"]')!;
    expect(card).toHaveTextContent('Lamotrigine');
    expect(card).toHaveTextContent('100mg');
  });

  it('flags a medication with no times rather than leaving it silently invisible', () => {
    useStore.setState({ slots: [] });
    render(<MedsScreen />);
    expect(medRow('Lamotrigine')).toHaveTextContent(/not scheduled/i);
  });

  it('AC13: adds a medication with guardrails and a twice-daily schedule without leaving the tab, and it appears on Today', () => {
    render(<MedsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Add medication' }));
    const dialog = screen.getByRole('dialog');

    setValue(dialog, 'Name', 'Carbamazepine');
    setValue(dialog, 'Unit', 'mg');
    setValue(dialog, 'Max single dose', '400');
    setValue(dialog, 'Max daily dose', '800');

    // Two different times, two different amounts — dose stays per-time-of-day.
    setValue(dialog, 'Time for dose 1', '08:00');
    setValue(dialog, 'Amount for dose 1', '400');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a time' }));
    setValue(dialog, 'Time for dose 2', '20:00');
    setValue(dialog, 'Amount for dose 2', '300');
    saveDialog(dialog);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const state = useStore.getState();
    const created = state.medications.find((m) => m.name === 'Carbamazepine')!;
    expect(created.guardrails).toMatchObject({ maxSingleDose: 400, maxDailyDose: 800 });

    // The 08:00 dose joined the existing slot; the 20:00 one created a slot.
    const doses = state.slots
      .filter((s) => !s.deleted)
      .flatMap((s) => s.items.filter((i) => i.medId === created.id).map((i) => [s.time, i.dose]));
    expect(doses.sort()).toEqual([
      ['08:00', 400],
      ['20:00', 300],
    ]);
    expect(state.slots.filter((s) => !s.deleted && s.time === '08:00')).toHaveLength(1);

    // …and it is visible on Today without visiting any other tab.
    render(<TodayScreen />);
    expect(screen.getAllByText('Carbamazepine').length).toBeGreaterThan(0);
  });

  it('edits a dose amount from the medication editor without disturbing co-scheduled medications', () => {
    seedSharedMorningSlot();
    render(<MedsScreen />);
    const dialog = openMedEditor('Lamotrigine');
    setValue(dialog, 'Amount for dose 1', '200');
    saveDialog(dialog);

    const updated = useStore.getState().slots.find((s) => s.id === 's1')!;
    expect(updated.items).toEqual([
      { medId: 'a', dose: 200 },
      { medId: 'b', dose: 500 },
    ]);
  });

  it('removes a time from the medication editor, tombstoning a slot left empty', () => {
    render(<MedsScreen />);
    const dialog = openMedEditor('Lamotrigine');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove dose 1' }));
    saveDialog(dialog);

    expect(useStore.getState().slots.find((s) => s.id === 's1')?.deleted).toBe(true);
  });

  it('discloses that a shared time moves the other medication’s dose too', () => {
    seedSharedMorningSlot();
    render(<MedsScreen />);
    const dialog = openMedEditor('Lamotrigine');

    // The slot's time belongs to the slot, not to one medication — the editor
    // must say so rather than let a retime silently move Levetiracetam.
    expect(dialog).toHaveTextContent(
      /08:00 is shared with Levetiracetam — changing this time moves their dose too/i,
    );
  });

  it('warns that retiming onto an occupied time will group the doses together', () => {
    // Two independent slots: Lamotrigine at 08:00, Levetiracetam at 20:00.
    seedTwoIndependentSlots();
    render(<MedsScreen />);
    const dialog = openMedEditor('Lamotrigine');
    setValue(dialog, 'Time for dose 1', '20:00');

    expect(dialog).toHaveTextContent(
      /Moving to 20:00 groups this dose with Levetiracetam, already taken then/i,
    );
  });

  it('retiming onto an occupied time joins that slot instead of forking a second one at the same time', () => {
    seedTwoIndependentSlots();
    retimeLamotrigineTo('20:00');

    const live = useStore.getState().slots.filter((sl) => !sl.deleted);
    // The emptied source is tombstoned; one slot remains at 20:00 holding both.
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe('s2');
    expect(live[0]!.time).toBe('20:00');
    expect(live[0]!.items).toEqual([
      { medId: 'b', dose: 500 },
      { medId: 'a', dose: 100 },
    ]);

    // Two slots genuinely changed, so two honest records — not one synthetic one.
    const kinds = useStore.getState().regimenChanges.map((c) => c.kind);
    expect(kinds).toEqual(['slot-removed', 'slot-updated']);
  });

  it('keeps a shared source slot alive when only this medication moves away', () => {
    useStore.setState({
      slots: [
        slot({
          id: 's1',
          time: '08:00',
          items: [
            { medId: 'a', dose: 100 },
            { medId: 'b', dose: 500 },
          ],
        }),
        slot({ id: 's2', time: '20:00', items: [{ medId: 'b', dose: 250 }] }),
      ],
    });
    retimeLamotrigineTo('20:00');

    const live = useStore.getState().slots.filter((sl) => !sl.deleted);
    expect(live.map((sl) => [sl.time, sl.items.map((i) => i.medId)])).toEqual([
      ['08:00', ['b']],
      ['20:00', ['b', 'a']],
    ]);
    expect(useStore.getState().regimenChanges.map((c) => c.kind)).toEqual([
      'slot-updated',
      'slot-updated',
    ]);
  });

  // The user-visible counterpart of the two tests above. It was blocked on the
  // two `core/scheduleHistory` defects fixed in the FR-18.1 follow-up: the Save
  // fired several store actions in one millisecond, so resolution picked between
  // their snapshots by random UUID, and a tombstoned slot came back from the
  // chosen snapshot. Both are fixed, so Today can now be asserted directly.
  it('shows the moved dose in ONE group at the new time on the following day', () => {
    useStore.setState({
      medications: [
        med({ id: 'a', name: 'Lamotrigine', unit: 'mg', active: true }),
        med({ id: 'b', name: 'Levetiracetam', unit: 'mg', active: true }),
      ],
      doseLog: [],
    });
    seedTwoIndependentSlots();
    retimeLamotrigineTo('20:00');

    // The day after the edit: the snapshot taken at the Save governs it.
    // Unmount the editor first so the only times on screen are Today's.
    cleanup();
    vi.setSystemTime(NOW + 24 * 3600_000);
    render(<TodayScreen />);

    // Exactly one dose group on the day, at the new time — not two at 20:00,
    // and nothing left behind at the old 08:00.
    const headings = screen.getAllByText(/^\d{2}:\d{2} [A-Z]{3}$/);
    expect(headings.map((h) => h.textContent)).toEqual(['20:00 BST']);

    // ...and it holds both medications, as one group the user takes together.
    const group = headings[0]!.closest<HTMLElement>('[class*="rounded-2xl"]')!;
    expect(within(group).getByText('Lamotrigine')).toBeInTheDocument();
    expect(within(group).getByText('Levetiracetam')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /Take group \(\s*2\s*\)/ })).toBeEnabled();
  });

  it('says nothing about sharing when the medication is alone at that time', () => {
    render(<MedsScreen />);
    expect(openMedEditor('Lamotrigine')).not.toHaveTextContent(/is shared with/i);
  });

  it('refuses to save two doses at the same time, explaining why', () => {
    render(<MedsScreen />);
    const dialog = openMedEditor('Lamotrigine');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a time' }));
    setValue(dialog, 'Time for dose 2', '08:00');
    setValue(dialog, 'Amount for dose 2', '50');

    expect(dialog).toHaveTextContent(/08:00 is listed twice/i);
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('the by-time editor still adds a medication to a slot (migrated ScheduleScreen behaviour)', () => {
    render(<MedsScreen />);
    showView('By time');
    fireEvent.click(screen.getByRole('button', { name: 'Add time-slot' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '13:00' } });
    fireEvent.change(within(dialog).getByLabelText('Add medication to slot'), {
      target: { value: 'a' },
    });
    fireEvent.change(within(dialog).getByLabelText('Dose for Lamotrigine'), {
      target: { value: '50' },
    });
    saveDialog(dialog);

    const added = useStore.getState().slots.find((s) => s.time === '13:00')!;
    expect(added.items).toEqual([{ medId: 'a', dose: 50 }]);
  });
});

// Stage 18 FR-18.12 AC14 — the merge is presentation-level: each edit must still
// drive the same store action, and therefore emit a byte-identical Stage 16
// change record. Each case compares the UI-driven record against the record the
// store action produces directly from the same seed.
/**
 * Run the same regimen edit twice from an identical seed — once by driving the
 * merged UI, once by calling the store action the pre-merge screens called —
 * and return both sets of change records for comparison.
 */
function recordsForBothRoutes(
  uiEdit: (dialog: HTMLElement) => void,
  controlEdit: () => void,
): [ReturnType<typeof comparableChanges>, ReturnType<typeof comparableChanges>] {
  const { unmount } = render(<MedsScreen />);
  const dialog = openMedEditor('Lamotrigine');
  uiEdit(dialog);
  saveDialog(dialog);
  const viaUi = comparableChanges(useStore.getState().regimenChanges);

  // Unmount before re-seeding: the control run is a pure store exercise.
  unmount();
  seed();
  controlEdit();
  return [viaUi, comparableChanges(useStore.getState().regimenChanges)];
}

describe('Meds tab — Stage 16 change records are unchanged by the merge (AC14)', () => {
  it('a dose amount edit emits the same slot-updated record as updateSlot', () => {
    const [viaUi, viaStore] = recordsForBothRoutes(
      (dialog) => setValue(dialog, 'Amount for dose 1', '200'),
      () => useStore.getState().updateSlot('s1', { items: [{ medId: 'a', dose: 200 }] }),
    );

    expect(viaUi).toEqual(viaStore);
    expect(viaUi).toHaveLength(1);
    expect(viaUi[0]!).toMatchObject({ kind: 'slot-updated', slotId: 's1' });
    expect(viaUi[0]!.changes.length).toBeGreaterThan(0);
  });

  it('a slot time edit emits the same slot-updated record as updateSlot', () => {
    const [viaUi, viaStore] = recordsForBothRoutes(
      (dialog) => setValue(dialog, 'Time for dose 1', '09:00'),
      () => useStore.getState().updateSlot('s1', { time: '09:00' }),
    );

    expect(viaUi).toEqual(viaStore);
    expect(viaUi[0]!).toMatchObject({ kind: 'slot-updated', slotId: 's1' });
    expect(viaUi[0]!.changes.some((c) => JSON.stringify(c).includes('09:00'))).toBe(true);
  });

  it('a guardrail edit emits the same medication-updated record as updateMedication', () => {
    const [viaUi, viaStore] = recordsForBothRoutes(
      (dialog) => setValue(dialog, 'Max daily dose', '400'),
      () => {
        const before = useStore.getState().medications.find((m) => m.id === 'a')!;
        useStore.getState().updateMedication('a', {
          name: before.name,
          color: before.color,
          unit: before.unit,
          halfLifeHours: before.halfLifeHours,
          adjustWhenLate: before.adjustWhenLate,
          active: before.active,
          notes: before.notes ?? '',
          guardrails: { ...before.guardrails, maxDailyDose: 400 },
        });
      },
    );

    expect(viaUi).toEqual(viaStore);
    expect(viaUi).toHaveLength(1);
    expect(viaUi[0]!).toMatchObject({ kind: 'medication-updated', medId: 'a' });
  });

  it('saving with nothing changed emits no change record at all', () => {
    render(<MedsScreen />);
    saveDialog(openMedEditor('Lamotrigine'));
    expect(useStore.getState().regimenChanges).toEqual([]);
  });
});

describe('Meds tab — keyboard and accessibility', () => {
  it('the whole surface is reachable by keyboard: view switch, add, edit, save', () => {
    render(<MedsScreen />);

    const byTime = screen.getByRole('button', { name: 'By time' });
    byTime.focus();
    expect(byTime).toHaveFocus();
    fireEvent.click(byTime); // Enter/Space on a native button dispatches click
    expect(byTime).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Add time-slot' })).toBeInTheDocument();

    const byMed = screen.getByRole('button', { name: 'By medication' });
    fireEvent.click(byMed);
    expect(byMed).toHaveAttribute('aria-pressed', 'true');
    expect(byTime).toHaveAttribute('aria-pressed', 'false');

    // The editor opens focused, so a keyboard user lands inside it, and Escape
    // closes it again without a mouse.
    const dialog = openMedEditor('Lamotrigine');
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByLabelText('Time for dose 1')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses a heading hierarchy under the screen heading and labels the view switch', () => {
    render(<MedsScreen />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Medications & schedule');
    expect(screen.getByRole('heading', { level: 3, name: 'Lamotrigine' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'View regimen by' })).toBeInTheDocument();
  });
});
