import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeGuide } from './ThemeGuide';

// Stage 19 Unit 3 (FR-19.8, AC19.5): "the theme guide renders every primitive
// in light and dark". This isn't a patient-facing screen, so we don't chase
// full behavioural coverage of each primitive (that's each primitive's own
// test file) — just that the gallery actually mounts one of each, and that
// the light/dark toggle really flips `document.documentElement.dataset.theme`
// (the mechanism the rest of the app's theming depends on).

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('ThemeGuide (FR-19.8)', () => {
  it('renders without error and mounts every listed primitive', () => {
    render(<ThemeGuide />);

    // Button — all variants + a disabled one.
    expect(screen.getByRole('button', { name: 'Primary' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Secondary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghost' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Danger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Primary disabled' })).toBeDisabled();

    // Card — presentational; assert its body copy renders.
    expect(screen.getByText(/soft-surface container/)).toBeInTheDocument();

    // Field — label, hint (FR-18.8), and an error example. Two Fields share
    // the "Name" label (a clean one and the error example).
    expect(screen.getAllByText('Name')).toHaveLength(2);
    expect(
      screen.getByText('Time for half the dose to clear your system — used to judge lateness.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    expect(screen.getByTestId('theme-guide-field-error-input')).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    // inputClass
    expect(screen.getByLabelText('Example input')).toBeInTheDocument();

    // ColorDot — decorative (aria-hidden spans); assert the swatch group mounted three.
    expect(screen.getByTestId('theme-guide-colordots').children).toHaveLength(3);

    // Ring + Stat
    expect(screen.getByLabelText('72% adherence')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('Doses this week')).toBeInTheDocument();

    // StatusBadge — every OccurrenceStatus this app has, plus the assumed variant.
    for (const label of ['Upcoming', 'Due', 'Taken', 'Missed', 'Skipped']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('On time')).toBeInTheDocument();

    // Modal / ConfirmDialog triggers are present (not opened yet).
    expect(screen.getByTestId('theme-guide-open-modal')).toBeInTheDocument();
    expect(screen.getByTestId('theme-guide-open-confirm')).toBeInTheDocument();

    // Token swatch sections.
    expect(screen.getByText('Colour tokens')).toBeInTheDocument();
    expect(screen.getByText('Radius tokens')).toBeInTheDocument();
    expect(screen.getByText('Elevation token')).toBeInTheDocument();
    expect(screen.getByText('Typography')).toBeInTheDocument();
    expect(screen.getByText('accent')).toBeInTheDocument();
    expect(screen.getByText('radius-full')).toBeInTheDocument();
  });

  it('opens the Modal trigger and the ConfirmDialog trigger', async () => {
    const user = userEvent.setup();
    render(<ThemeGuide />);

    await user.click(screen.getByTestId('theme-guide-open-modal'));
    const modal = await screen.findByRole('dialog', { name: 'Example modal' });
    expect(within(modal).getByText(/Modal body content/)).toBeInTheDocument();
    await user.click(within(modal).getByRole('button', { name: 'Close' }));

    await user.click(screen.getByTestId('theme-guide-open-confirm'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete this medication?' });
    expect(within(confirm).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('toggling the theme flips document.documentElement.dataset.theme and both states render legibly', async () => {
    const user = userEvent.setup();
    render(<ThemeGuide />);

    // Starts dark (component default) unless the root already carries a theme.
    // The label and the actual DOM attribute must agree from first paint —
    // a prior bug set the label without touching `data-theme`, so the first
    // render silently fell through to `prefers-color-scheme` while claiming
    // "dark".
    expect(screen.getByTestId('theme-guide-current-theme')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    await user.click(screen.getByTestId('theme-guide-toggle'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByTestId('theme-guide-current-theme')).toHaveTextContent('light');
    // The primitives are still mounted and readable after the flip.
    expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByText('Taken')).toBeInTheDocument();

    await user.click(screen.getByTestId('theme-guide-toggle'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByTestId('theme-guide-current-theme')).toHaveTextContent('dark');
  });
});
