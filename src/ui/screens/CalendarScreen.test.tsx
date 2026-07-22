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

    expect(screen.getByText('· missed')).toBeInTheDocument();
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
