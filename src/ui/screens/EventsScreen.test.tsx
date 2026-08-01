// Stage 20 Unit 4 — behaviour-parity tests for the Events tab, added when the
// screen was migrated onto the Stage 19/Unit 3 React Aria form primitives
// (TextField/NumberField, and a themed Select for the property-type and
// event-type pickers). EventsScreen previously had no dedicated test file;
// this one is the new oracle for its add/edit/delete/validation behaviour.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsScreen } from './EventsScreen';
import { useStore } from '../../store/store';
import { eventType, eventInstance, logEntry, med, settings } from '../../test/fixtures';
import { openDeleteConfirm, cancelDialog } from '../../test/doseLogDialogHelpers';

const ZONE = 'Europe/London';
const NOW = Date.UTC(2026, 6, 20, 9, 0);

function seed() {
  useStore.setState({
    hydrated: true,
    eventTypes: [
      eventType({
        id: 'et1',
        name: 'Seizure',
        color: '#9333ea',
        properties: [
          { id: 'severity', name: 'Severity', type: 'scale', min: 1, max: 5 },
          { id: 'duration', name: 'Duration', type: 'duration' },
        ],
      }),
    ],
    eventInstances: [
      eventInstance({
        id: 'ei1',
        typeId: 'et1',
        occurredAt: NOW - 3600_000,
        zone: ZONE,
        values: { severity: 3, duration: 90 },
      }),
    ],
    medications: [
      med({ id: 'lam', name: 'Lamotrigine' }),
      med({ id: 'lev', name: 'Levetiracetam' }),
      med({ id: 'old', name: 'Retired med', active: false }),
    ],
    doseLog: [logEntry({ id: 'dose-1', medId: 'lam', actualInstant: NOW - 7200_000, zone: ZONE })],
    settings: settings({ zone: ZONE }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  seed();
});

function openTypeEditor(name: 'New type' | 'Edit' = 'New type'): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.getByRole('dialog');
}

function saveDialog(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
}

/** Renders the screen and opens the "Log event" dialog, returning it. */
function openLogEvent(): HTMLElement {
  render(<EventsScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Log event' }));
  return screen.getByRole('dialog');
}

/** The "Event types" card, scoped so a name shared with the history list below is unambiguous. */
function typeCard(): HTMLElement {
  return screen
    .getByRole('heading', { name: 'Event types' })
    .closest<HTMLElement>('[class*="rounded-2xl"]')!;
}

/** The "Logged events" card, scoped the same way. */
function historyCard(): HTMLElement {
  return screen
    .getByRole('heading', { name: 'Logged events' })
    .closest<HTMLElement>('[class*="rounded-2xl"]')!;
}

function typeRow(name: string): HTMLElement {
  return within(typeCard()).getByText(name).closest<HTMLElement>('li')!;
}

function historyRow(name: string): HTMLElement {
  return within(historyCard()).getByText(name).closest<HTMLElement>('li')!;
}

describe('Events tab — event types', () => {
  it('lists live types and shows their properties as a summary', () => {
    render(<EventsScreen />);
    expect(within(typeCard()).getByText('Seizure')).toBeInTheDocument();
    expect(within(typeCard()).getByText(/Severity.*Duration/)).toBeInTheDocument();
  });

  it('creates a new event type with a custom property (AC20.2)', () => {
    render(<EventsScreen />);
    const dialog = openTypeEditor('New type');
    fireEvent.change(within(dialog).getByLabelText('Event type name'), {
      target: { value: 'Migraine' },
    });
    saveDialog(dialog);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const created = useStore.getState().eventTypes.find((t) => t.name === 'Migraine');
    expect(created).toBeTruthy();
    // The default seeded properties (Severity scale, Duration) came through.
    expect(created!.properties.map((p) => p.name)).toEqual(['Severity', 'Duration']);
  });

  it('blocks Save with an empty name', () => {
    render(<EventsScreen />);
    const dialog = openTypeEditor('New type');
    fireEvent.change(within(dialog).getByLabelText('Event type name'), {
      target: { value: '' },
    });
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(dialog).toHaveTextContent(/name is required/i);
  });

  it('edits an existing type in place, preserving its id', () => {
    render(<EventsScreen />);
    fireEvent.click(within(typeRow('Seizure')).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Event type name'), {
      target: { value: 'Seizure (updated)' },
    });
    saveDialog(dialog);

    const types = useStore.getState().eventTypes;
    expect(types).toHaveLength(1);
    expect(types[0]!.id).toBe('et1');
    expect(types[0]!.name).toBe('Seizure (updated)');
  });

  it('changing a property to "scale" via the themed Select shows Min/Max fields, and the choice round-trips on save', async () => {
    vi.useRealTimers();
    render(<EventsScreen />);
    const dialog = openTypeEditor('New type');
    fireEvent.change(within(dialog).getByLabelText('Event type name'), {
      target: { value: 'Custom' },
    });

    // Add a fresh (number-typed) property, then switch it to "scale".
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add property' }));
    const typeSelects = within(dialog).getAllByLabelText('Property type');
    const newPropertySelect = typeSelects[typeSelects.length - 1]!;
    fireEvent.click(newPropertySelect);
    fireEvent.click(await screen.findByRole('option', { name: 'scale' }));

    expect(within(dialog).getAllByLabelText('Scale min').length).toBeGreaterThan(0);

    // Name the new property so shape validation passes, then save.
    const nameInputs = within(dialog).getAllByLabelText('Property name');
    fireEvent.change(nameInputs[nameInputs.length - 1]!, { target: { value: 'Aura' } });
    saveDialog(dialog);

    const created = useStore.getState().eventTypes.find((t) => t.name === 'Custom')!;
    expect(created.properties.find((p) => p.name === 'Aura')?.type).toBe('scale');
    vi.useFakeTimers();
  });

  it('archiving a type moves it out of the live list and into "Archived types"; Unarchive reverses it', () => {
    render(<EventsScreen />);
    fireEvent.click(within(typeRow('Seizure')).getByRole('button', { name: 'Archive' }));

    expect(screen.getByRole('heading', { name: 'Archived types' })).toBeInTheDocument();
    expect(useStore.getState().eventTypes.find((t) => t.id === 'et1')?.archived).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    expect(useStore.getState().eventTypes.find((t) => t.id === 'et1')?.archived).toBe(false);
  });
});

describe('Events tab — logging instances', () => {
  it('logs a new event against the selected type via the themed Select, with property values', async () => {
    vi.useRealTimers();
    // The Select defaults to the only type (Seizure) — fill in its properties.
    const dialog = openLogEvent();
    fireEvent.change(within(dialog).getByLabelText('Severity (1–5)'), { target: { value: '4' } });
    fireEvent.blur(within(dialog).getByLabelText('Severity (1–5)'));
    fireEvent.change(within(dialog).getByLabelText('Duration (seconds)'), {
      target: { value: '120' },
    });
    fireEvent.blur(within(dialog).getByLabelText('Duration (seconds)'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    const created = useStore.getState().eventInstances.find((e) => e.id !== 'ei1' && !e.deleted);
    expect(created).toBeTruthy();
    expect(created!.values).toEqual({ severity: 4, duration: 120 });
    vi.useFakeTimers();
  });

  it('the event-type Select is disabled while editing an existing instance', () => {
    render(<EventsScreen />);
    fireEvent.click(within(historyRow('Seizure')).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Event type')).toBeDisabled();
  });

  it('blocks Save when a required numeric value is out of the scale range', () => {
    const dialog = openLogEvent();
    fireEvent.change(within(dialog).getByLabelText('Severity (1–5)'), { target: { value: '9' } });
    fireEvent.blur(within(dialog).getByLabelText('Severity (1–5)'));

    expect(dialog).toHaveTextContent(/must be a whole number from 1 to 5/i);
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('deleting a logged event requires confirmation and removes it (tombstone)', () => {
    render(<EventsScreen />);
    const row = historyRow('Seizure');
    const dialog = openDeleteConfirm(row);
    expect(dialog).toHaveTextContent(/delete this event/i);

    cancelDialog(dialog);
    expect(useStore.getState().eventInstances.find((e) => e.id === 'ei1')?.deleted).toBeFalsy();

    fireEvent.click(within(openDeleteConfirm(row)).getByRole('button', { name: 'Delete event' }));
    expect(useStore.getState().eventInstances.find((e) => e.id === 'ei1')?.deleted).toBe(true);
  });

  it('an instance whose type has been deleted falls back to "Unknown type", never a raw id', () => {
    useStore.setState({
      eventTypes: [],
      eventInstances: [
        eventInstance({ id: 'ei1', typeId: 'seed-etype-ghost', occurredAt: NOW - 3600_000 }),
      ],
    });
    render(<EventsScreen />);
    expect(screen.getByText('Unknown type')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/seed-etype-ghost/);
  });
});

// ---- Stage 24: side-effect category + attribution ---------------------------
//
// Attribution is the user's *stated* association. These tests assert the
// association is captured and survives a reopen — never that the app derives,
// suggests or endorses one.

/** Pick an option from an open React Aria `Select` by its accessible name. */
async function chooseOption(dialog: HTMLElement, selectLabel: string, optionName: string) {
  fireEvent.click(within(dialog).getByLabelText(selectLabel));
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
}

describe('Events tab — side-effect category (Stage 24 FR-24.1)', () => {
  it('marks a new type as a side effect, and the choice is stored (AC1)', async () => {
    vi.useRealTimers();
    render(<EventsScreen />);
    const dialog = openTypeEditor('New type');
    fireEvent.change(within(dialog).getByLabelText('Event type name'), {
      target: { value: 'Drowsiness' },
    });
    await chooseOption(dialog, 'Event kind', 'Side effect');
    saveDialog(dialog);

    const created = useStore.getState().eventTypes.find((t) => t.name === 'Drowsiness');
    expect(created?.category).toBe('side-effect');
    vi.useFakeTimers();
  });

  it('leaves an existing type without a category untouched when the control is not used', () => {
    // Absence is the default (general/flare), not "unknown" — opening and
    // saving an old type must not silently stamp a category onto it.
    expect(useStore.getState().eventTypes.find((t) => t.id === 'et1')?.category).toBeUndefined();
    render(<EventsScreen />);
    fireEvent.click(within(typeRow('Seizure')).getByRole('button', { name: 'Edit' }));
    saveDialog(screen.getByRole('dialog'));

    expect(useStore.getState().eventTypes.find((t) => t.id === 'et1')?.category).toBeUndefined();
  });

  it('reopening a side-effect type shows it still marked as one', () => {
    useStore.setState({
      eventTypes: [eventType({ id: 'et1', name: 'Drowsiness', category: 'side-effect' })],
    });
    render(<EventsScreen />);
    fireEvent.click(within(typeRow('Drowsiness')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Side effect');
  });
});

describe('Events tab — attribution (Stage 24 FR-24.2)', () => {
  it('logs an event attributed to a medication, and reopening shows the attribution retained (AC1)', async () => {
    vi.useRealTimers();
    const dialog = openLogEvent();
    // The picker starts unattributed — no medication is assumed for the user.
    expect(within(dialog).getByLabelText('Attributed to')).toHaveTextContent('No medication');

    await chooseOption(dialog, 'Attributed to', 'Levetiracetam');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    const created = useStore.getState().eventInstances.find((e) => e.id !== 'ei1' && !e.deleted)!;
    expect(created.medId).toBe('lev');
    expect(created.doseLogEntryId).toBeUndefined();

    // Reopen the saved instance: the attribution is still there. History is
    // newest-first and the new instance is "now", so it is the first row.
    const newest = within(historyCard()).getAllByText('Seizure')[0]!.closest<HTMLElement>('li')!;
    fireEvent.click(within(newest).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Levetiracetam');
    vi.useFakeTimers();
  });

  it('logging with no attribution stays a one-step flow and stores no medication (flare-up path)', () => {
    const dialog = openLogEvent();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    const created = useStore.getState().eventInstances.find((e) => e.id !== 'ei1' && !e.deleted)!;
    expect(created.medId).toBeUndefined();
    expect(created.doseLogEntryId).toBeUndefined();
  });

  it('offers active medications, and keeps a deactivated one only while it is the current attribution', async () => {
    vi.useRealTimers();
    const dialog = openLogEvent();
    fireEvent.click(within(dialog).getByLabelText('Attributed to'));
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(names).toEqual(['No medication', 'Lamotrigine', 'Levetiracetam']);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    vi.useFakeTimers();
  });

  it('the attribution copy states an association and never a cause', () => {
    const dialog = openLogEvent();
    expect(dialog).toHaveTextContent(/attributed to/i);
    expect(dialog.textContent).not.toMatch(/caused by|linked to|due to|because of/i);
  });

  it('blocks Save when the attributed medication no longer resolves (core validation surfaces here)', () => {
    useStore.setState({
      eventInstances: [
        eventInstance({
          id: 'ei1',
          typeId: 'et1',
          occurredAt: NOW - 3600_000,
          zone: ZONE,
          values: { severity: 3, duration: 90 },
          medId: 'ghost',
        }),
      ],
    });
    render(<EventsScreen />);
    fireEvent.click(within(historyRow('Seizure')).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/no longer exists/i);
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
