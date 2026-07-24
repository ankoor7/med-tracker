import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CalendarScreen } from './CalendarScreen';
import { useStore } from '../../store/store';
import { med, settings, slot, logEntry } from '../../test/fixtures';
import { withFixedClock } from '../../test/fixedClock';

const ZONE = 'Europe/London';
// 2026-06-15 20:00 London (BST) == 19:00 UTC — well after the single 08:00
// slot below, so it is always past-due for these tests.
const NOW = Date.UTC(2026, 5, 15, 19, 0);

function seed(assumeTakenOnTime: boolean, doseLog: ReturnType<typeof logEntry>[] = []) {
  useStore.setState({
    hydrated: true,
    medications: [med({ id: 'a', name: 'Lamotrigine', unit: 'mg', adjustWhenLate: true })],
    slots: [
      slot({ id: 's1', time: '08:00', label: 'Morning', items: [{ medId: 'a', dose: 100 }] }),
    ],
    doseLog,
    settings: settings({ zone: ZONE, assumeTakenOnTime }),
  });
}

withFixedClock(NOW);
beforeEach(() => seed(true));

// Stage 18 FR-18.6 — the calendar defect this closes: assumed-taken, missed,
// and upcoming doses all rendered as the same dashed block, distinguished only
// by a 10px "· missed" label. An assumed-taken group must now read distinctly
// from both a genuinely-logged group and an unresolved (missed/upcoming) one —
// via more than colour alone (a distinct border style, a text label, and a
// glyph, not merely a tint).
describe('CalendarScreen — assumed vs logged vs missed (Stage 18 FR-18.6)', () => {
  it('an assumed-taken dose (empty log, assumeTakenOnTime on) is labelled "assumed", not left indistinguishable from missed/upcoming', () => {
    seed(true, []);
    render(<CalendarScreen />);

    // It reads as assumed, not as missed.
    expect(screen.getByText('· assumed')).toBeInTheDocument();
    expect(screen.queryByText('· missed')).not.toBeInTheDocument();
    // The assumed glyph is present (a non-colour cue); the "logged" checkmark is not.
    expect(screen.getByText('◇')).toBeInTheDocument();
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });

  it('a genuinely-logged dose shows the logged checkmark, not the assumed glyph or label', () => {
    const real = logEntry({
      id: 'l1',
      slotId: 's1',
      medId: 'a',
      scheduledInstant: NOW - 3600_000,
      actualInstant: NOW - 3600_000,
      dose: 100,
      status: 'taken',
    });
    seed(true, [real]);
    render(<CalendarScreen />);

    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.queryByText('◇')).not.toBeInTheDocument();
    expect(screen.queryByText('· assumed')).not.toBeInTheDocument();
  });

  it('with assumeTakenOnTime off, the same unlogged dose reads as missed, not assumed', () => {
    seed(false, []);
    render(<CalendarScreen />);

    // Stage 18 FR-18.9(c) gave missed its own glyph ("⚠") distinct from the
    // plain "·" bullet still used for assumed, on top of the existing text.
    expect(screen.getByText('⚠ missed')).toBeInTheDocument();
    expect(screen.queryByText('· assumed')).not.toBeInTheDocument();
    expect(screen.queryByText('◇')).not.toBeInTheDocument();
  });

  it('the assumed border style is distinguishable from the neutral missed/upcoming dashed style, not colour alone', () => {
    seed(true, []);
    const { container } = render(<CalendarScreen />);
    const block = container.querySelector('[data-block="true"]')!;
    // A distinct border-style class (not the neutral slate-600 dashed style
    // shared by missed/upcoming), independently of the text label/glyph above.
    expect(block.className).toContain('border-status-taken/50');
    expect(block.className).not.toContain('border-slate-600');
  });
});

// Stage 18 FR-18.9(a) — a guardrail breach (min-interval or over-cap) created
// by a calendar drag was previously only discoverable in History → Dose log;
// the calendar itself hid the exact conflict it had just created. A logged
// occurrence carrying `DoseLogEntry.warnings` must now show a breach
// indicator directly on its block, with a non-colour cue and an accessible
// label, using the shared `classifyGuardrailBreach` for the kind.
describe('CalendarScreen — guardrail breach indicator on the calendar (FR-18.9a)', () => {
  it('a logged dose with a too-soon (min-interval) warning shows a breach glyph and label, not silently hidden', () => {
    const breaching = logEntry({
      id: 'l1',
      slotId: 's1',
      medId: 'a',
      scheduledInstant: NOW - 3600_000,
      actualInstant: NOW - 3600_000,
      dose: 100,
      status: 'taken',
      warnings: ['Below min interval (1.0h since last dose < 6.0h).'],
    });
    seed(true, [breaching]);
    render(<CalendarScreen />);

    // The group-level chip: a glyph plus an explicit, breach-kind-aware label
    // (never colour alone).
    expect(screen.getByText(/⚠ too-soon/)).toBeInTheDocument();
    expect(screen.getByLabelText('Guardrail breach: too-soon')).toBeInTheDocument();
  });

  it('a logged dose with an over-cap warning is labelled "over-cap", not "too-soon" or a generic default', () => {
    const breaching = logEntry({
      id: 'l1',
      slotId: 's1',
      medId: 'a',
      scheduledInstant: NOW - 3600_000,
      actualInstant: NOW - 3600_000,
      dose: 999,
      status: 'taken',
      warnings: ['Exceeds max single dose (999mg > 200mg).'],
    });
    seed(true, [breaching]);
    render(<CalendarScreen />);

    expect(screen.getByText(/⚠ over-cap/)).toBeInTheDocument();
    expect(screen.queryByText(/⚠ too-soon/)).not.toBeInTheDocument();
  });

  it('a logged dose with no warnings shows no breach indicator', () => {
    const clean = logEntry({
      id: 'l1',
      slotId: 's1',
      medId: 'a',
      scheduledInstant: NOW - 3600_000,
      actualInstant: NOW - 3600_000,
      dose: 100,
      status: 'taken',
      warnings: [],
    });
    seed(true, [clean]);
    render(<CalendarScreen />);

    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
  });

  it('mixed member states: a breaching member takes precedence over the border used for a plain logged group', () => {
    useStore.setState({
      hydrated: true,
      medications: [
        med({ id: 'a', name: 'Lamotrigine', unit: 'mg' }),
        med({ id: 'b', name: 'Levetiracetam', unit: 'mg' }),
      ],
      slots: [
        slot({
          id: 's1',
          time: '08:00',
          label: 'Morning',
          items: [
            { medId: 'a', dose: 100 },
            { medId: 'b', dose: 200 },
          ],
        }),
      ],
      doseLog: [
        logEntry({
          id: 'la',
          slotId: 's1',
          medId: 'a',
          scheduledInstant: NOW - 3600_000,
          actualInstant: NOW - 3600_000,
          dose: 100,
          status: 'taken',
          warnings: [],
        }),
        logEntry({
          id: 'lb',
          slotId: 's1',
          medId: 'b',
          scheduledInstant: NOW - 3600_000,
          actualInstant: NOW - 3600_000,
          dose: 200,
          status: 'taken',
          warnings: ['Below min interval (1.0h since last dose < 6.0h).'],
        }),
      ],
      settings: settings({ zone: ZONE, assumeTakenOnTime: true }),
    });
    const { container } = render(<CalendarScreen />);
    const block = container.querySelector('[data-block="true"]')!;

    expect(screen.getByText(/⚠ too-soon/)).toBeInTheDocument();
    expect(block.className).toContain('border-red-600');
  });
});

// Stage 18 FR-18.9(c) — missed, upcoming, and assumed-taken must be
// distinguishable at a glance, not just by a 10px text difference. This
// extends the FR-18.6 coverage above to also separate missed from upcoming
// (previously both fell through to the identical neutral dashed style).
describe('CalendarScreen — missed vs upcoming vs assumed distinguishability (FR-18.9c)', () => {
  function seedMissedAndUpcoming() {
    useStore.setState({
      hydrated: true,
      medications: [med({ id: 'a', name: 'Lamotrigine', unit: 'mg' })],
      slots: [
        slot({ id: 's1', time: '08:00', label: 'Morning', items: [{ medId: 'a', dose: 100 }] }),
        slot({ id: 's2', time: '22:00', label: 'Evening', items: [{ medId: 'a', dose: 100 }] }),
      ],
      doseLog: [],
      // assumeTakenOnTime off so the past, unlogged morning slot reads as missed.
      settings: settings({ zone: ZONE, assumeTakenOnTime: false }),
    });
  }

  it('missed and upcoming blocks use different border styles (not colour alone)', () => {
    seedMissedAndUpcoming();
    const { container } = render(<CalendarScreen />);
    const blocks = [...container.querySelectorAll('[data-block="true"]')];
    expect(blocks).toHaveLength(2);
    const classes = blocks.map((b) => b.className);
    // Distinct border-style keywords (dashed vs dotted), not just a colour swap.
    expect(classes.some((c) => c.includes('border-dashed') && c.includes('status-missed'))).toBe(
      true,
    );
    expect(classes.some((c) => c.includes('border-dotted'))).toBe(true);
  });

  it('missed and upcoming carry distinct accessible names and glyphs', () => {
    seedMissedAndUpcoming();
    render(<CalendarScreen />);

    expect(screen.getByText('⚠ missed')).toBeInTheDocument();
    expect(screen.getByText('○ upcoming')).toBeInTheDocument();
    expect(screen.getByLabelText('Missed, not logged')).toBeInTheDocument();
    expect(screen.getByLabelText('Upcoming, not yet logged')).toBeInTheDocument();
  });

  it('the accessible group name states "Missed" / "Upcoming" so they are distinguishable to screen readers too', () => {
    seedMissedAndUpcoming();
    render(<CalendarScreen />);

    expect(screen.getByRole('button', { name: /Missed, not logged/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upcoming, not yet logged/ })).toBeInTheDocument();
  });
});
