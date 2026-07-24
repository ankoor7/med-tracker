import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ChangeMarkers } from './ChangeMarkers';
import type { ISODate } from '../../core';
import { regimenChange } from '../../test/fixtures';

const ZONE = 'Europe/London';
const at = (h: number) => Date.UTC(2026, 5, 12, h, 0); // 2026-06-12 in UTC/BST

// A trivial axis: every date maps to the same spot. Sufficient for asserting the
// marker/grouping behaviour without chart geometry.
const xForDate = (_date: ISODate) => 50;

describe('ChangeMarkers', () => {
  it('renders one grouped marker per day with a count badge (FR-16.6)', () => {
    const changes = [
      regimenChange({ id: 'a', changedAt: at(8), summary: 'Morning dose 100mg → 150mg' }),
      regimenChange({ id: 'b', changedAt: at(20), summary: 'Added 20:00 Evening' }),
    ];
    render(<ChangeMarkers changes={changes} zone={ZONE} xForDate={xForDate} />);
    // Two same-day changes → a single marker labelled with the count.
    const markers = screen.getAllByRole('button', { name: /regimen change/i });
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveTextContent('2');
  });

  it('opens a detail popover listing each change and its diffs (FR-16.5)', async () => {
    const user = userEvent.setup();
    const changes = [
      regimenChange({
        id: 'a',
        changedAt: at(8),
        kind: 'slot-updated',
        summary: 'Morning: Lamotrigine dose 100mg → 150mg',
        changes: [{ field: 'Lamotrigine dose', from: '100mg', to: '150mg' }],
      }),
    ];
    render(<ChangeMarkers changes={changes} zone={ZONE} xForDate={xForDate} />);
    await user.click(screen.getByRole('button', { name: /lamotrigine dose 100mg/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Morning: Lamotrigine dose 100mg → 150mg/)).toBeInTheDocument();
    // The field-level diff row renders the field label and its from → to values.
    expect(within(dialog).getByText('Lamotrigine dose:')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/100mg → 150mg/).length).toBeGreaterThanOrEqual(1);
  });

  // Stage 18 FR-18.1 — the marker layer renders from the display strings, which
  // both old (display-only) and new (structured) records carry. Grouping and the
  // popover must not depend on the machine layer being present.
  it('groups and renders a legacy record and a structured one together', async () => {
    const user = userEvent.setup();
    const changes = [
      regimenChange({
        id: 'legacy',
        changedAt: at(8),
        kind: 'slot-updated',
        summary: 'Morning: Lamotrigine dose 100mg → 150mg',
        // Exactly the seed's pre-Stage-18 shape: no key/medId/typed values.
        changes: [{ field: 'Lamotrigine dose', from: '100mg', to: '150mg' }],
      }),
      regimenChange({
        id: 'structured',
        changedAt: at(20),
        kind: 'medication-reactivated',
        summary: 'Resumed Levetiracetam',
        changes: [
          {
            field: 'Status',
            from: 'Retired',
            to: 'Active',
            key: 'med.active',
            medId: 'm1',
            fromValue: false,
            toValue: true,
          },
        ],
      }),
    ];
    render(<ChangeMarkers changes={changes} zone={ZONE} xForDate={xForDate} />);

    const markers = screen.getAllByRole('button', { name: /regimen change/i });
    expect(markers).toHaveLength(1); // same day → one grouped marker
    await user.click(markers[0]!);

    const dialog = screen.getByRole('dialog');
    // Legacy record still renders its diff row unchanged.
    expect(within(dialog).getByText('Lamotrigine dose:')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/100mg → 150mg/).length).toBeGreaterThanOrEqual(1);
    // The new kind has a label of its own, and the structured row renders from
    // its display strings just like any other.
    expect(within(dialog).getByText('Medication resumed')).toBeInTheDocument();
    expect(within(dialog).getByText('Status:')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Retired → Active/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders nothing when no change falls on the plotted axis', () => {
    const { container } = render(
      <ChangeMarkers
        changes={[regimenChange({ id: 'a', changedAt: at(8) })]}
        zone={ZONE}
        xForDate={() => null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
