import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StartDatePrompt } from './StartDatePrompt';
import { useStore } from '../../store/store';
import { setRepository, nullRepository, type Repository } from '../../store/repository';
import { logEntry, med } from '../../test/fixtures';
import type { Medication } from '../../core';

const ZONE = 'Europe/London';

/** In-memory `meta` store so dismissal-persistence can be asserted. */
function fakeRepository(): Repository {
  const meta = new Map<string, string>();
  return {
    ...nullRepository,
    async getMeta(key) {
      return meta.get(key) ?? null;
    },
    async setMeta(key, value) {
      meta.set(key, value);
    },
  };
}

function setMedications(
  medications: Partial<Medication>[],
  doseLog: ReturnType<typeof logEntry>[] = [],
) {
  useStore.setState({
    medications: medications.map((m) => med(m)),
    doseLog,
    settings: {
      zone: ZONE,
      adherenceWindowDays: 7,
      missedDayThreshold: 3,
      assumeTakenOnTime: true,
      updatedAt: 0,
    },
  });
}

/** A warning must never block the save — assert the click still commits `startedAt`. */
async function expectSaveStillWorks(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(useStore.getState().medications.find((m) => m.id === 'a')?.startedAt).toBeDefined();
}

const nativeDateValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value',
)!.set!;

/**
 * Sets a `'YYYY-MM-DD'` date on the `DateField` (Stage 20 Unit 5) labelled
 * `label`. `DateField` (built on React Aria's `DateField`/`DateSegment`) also
 * renders a visually-hidden native `<input type="date">` alongside its
 * segmented spinbuttons — for mobile platforms that show a native date
 * picker — kept in sync with the same field state. Driving that hidden input
 * is the simplest reliable way to set a full date value in jsdom (typing
 * digit-by-digit into the individual segments requires simulating React
 * Aria's internal focus-driven segment-advance behaviour, which jsdom's
 * `beforeinput`/focus emulation doesn't reproduce faithfully).
 */
function typeStartDate(label: string, isoDate: string) {
  const group = screen.getAllByLabelText(label).find((el) => el.getAttribute('role') === 'group')!;
  // The hidden native date input is a sibling of the DateField's own root
  // (`group`'s parent), not a descendant of it.
  const native = group.parentElement!.nextElementSibling!.querySelector(
    'input[type="date"]',
  ) as HTMLInputElement;
  act(() => {
    native.focus();
    nativeDateValueSetter.call(native, isoDate);
    native.dispatchEvent(new Event('input', { bubbles: true }));
    native.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  setRepository(fakeRepository());
});

afterEach(() => {
  setRepository(nullRepository);
});

describe('StartDatePrompt (FR-18.1 piece 3)', () => {
  it('does not appear when every medication already has a startedAt (fresh install)', async () => {
    setMedications([
      { id: 'a', startedAt: 1 },
      { id: 'b', startedAt: 2 },
    ]);
    render(<StartDatePrompt />);
    // Give the getMeta() lookup a tick to resolve before asserting absence.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not appear when there are no medications at all', async () => {
    setMedications([]);
    render(<StartDatePrompt />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('appears listing each medication missing a startedAt', async () => {
    setMedications([
      { id: 'a', name: 'Lamotrigine', startedAt: undefined },
      { id: 'b', name: 'Vitamin D', startedAt: 5 },
    ]);
    render(<StartDatePrompt />);
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Lamotrigine start date')).toBeInTheDocument();
    // Vitamin D already has a startedAt — not part of the prompt.
    expect(screen.queryByLabelText('Vitamin D start date')).not.toBeInTheDocument();
  });

  it('Skip for now leaves the medication unset and does not reappear', async () => {
    const user = userEvent.setup();
    setMedications([{ id: 'a', name: 'Lamotrigine', startedAt: undefined }]);
    render(<StartDatePrompt />);
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Semantics unchanged: startedAt is still unset.
    expect(useStore.getState().medications.find((m) => m.id === 'a')?.startedAt).toBeUndefined();
  });

  it('Save sets startedAt only for the medications a date was entered for', async () => {
    const user = userEvent.setup();
    setMedications([
      { id: 'a', name: 'Lamotrigine', startedAt: undefined },
      { id: 'b', name: 'Levetiracetam', startedAt: undefined },
    ]);
    render(<StartDatePrompt />);
    await screen.findByRole('dialog');

    // Fill in a date for Lamotrigine only; leave Levetiracetam blank.
    typeStartDate('Lamotrigine start date', '2026-06-01');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const meds = useStore.getState().medications;
    expect(meds.find((m) => m.id === 'a')?.startedAt).toBeDefined();
    // Left blank — still "always existed", nothing broke.
    expect(meds.find((m) => m.id === 'b')?.startedAt).toBeUndefined();
  });

  it('warns (but does not block) on a future start date', async () => {
    const user = userEvent.setup();
    setMedications([{ id: 'a', name: 'Lamotrigine', startedAt: undefined }]);
    render(<StartDatePrompt />);
    await screen.findByRole('dialog');

    typeStartDate('Lamotrigine start date', '2999-01-01');
    expect(screen.getByText('This date is in the future.')).toBeInTheDocument();
    await expectSaveStillWorks(user);
  });

  it('warns (but does not block) when a dose is already logged before the chosen start date', async () => {
    const user = userEvent.setup();
    setMedications(
      [{ id: 'a', name: 'Lamotrigine', startedAt: undefined }],
      [logEntry({ medId: 'a', actualInstant: Date.parse('2026-06-01T08:00:00Z') })],
    );
    render(<StartDatePrompt />);
    await screen.findByRole('dialog');

    // A dose was logged on 2026-06-01 — choosing a later start date contradicts it.
    typeStartDate('Lamotrigine start date', '2026-06-10');
    expect(screen.getByText('A dose is already logged before this date.')).toBeInTheDocument();
    await expectSaveStillWorks(user);
  });
});
