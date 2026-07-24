import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { User } from '@react-aria/test-utils';
import App from './App';

// Stage 20 Unit 1 (FR-20.1/20.2/20.5): the bottom nav is now a real WAI-ARIA
// `tablist`/`tab` (React Aria `Tabs`), not five plain buttons toggling local
// state by hand. This is the behaviour-parity oracle for that migration: all
// five tabs still switch screens, the selected tab has an accessible selected
// state plus a non-colour cue (not just a colour swap — FR-18.9's bar), and
// the tablist is keyboard-operable per the ARIA tabs pattern (arrow keys move
// + auto-activate).
const testUtilUser = new User({ interactionType: 'mouse' });

async function renderReady() {
  render(<App />);
  // Wait for first-run hydration/seed so the async state update settles
  // (mirrors App.smoke.test.tsx).
  await screen.findByRole('heading', { level: 2, name: 'Today' });
}

describe('App bottom nav — Tabs (FR-20.1/20.2/20.5)', () => {
  it('exposes a labelled tablist of the five tabs, Today selected by default', async () => {
    await renderReady();
    const nav = screen.getByRole('navigation');
    const tabsTester = testUtilUser.createTester('Tabs', { root: nav });

    const tabs = tabsTester.getTabs();
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Today',
      'Calendar',
      'Meds',
      'Events',
      'History',
    ]);

    const selected = tabsTester.getSelectedTab();
    expect(selected).toHaveTextContent('Today');
    // Accessible selected state, not just a visual one.
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveAttribute('data-selected');
    // Non-colour cue: the selected tab also carries a font-weight change and
    // a bolder icon stroke, not merely an accent-colour class (App.tsx TabIcon
    // + the Tab className both key off `data-[selected]`).
    expect(selected?.className).toContain('data-[selected]:font-semibold');
    const icon = selected?.querySelector('svg');
    expect(icon?.getAttribute('class')).toContain('group-data-[selected]:stroke-[2.4]');
  });

  it('switching tabs via the tester shows the corresponding screen (Today <-> Meds)', async () => {
    await renderReady();
    const nav = screen.getByRole('navigation');
    const tabsTester = testUtilUser.createTester('Tabs', { root: nav });

    await tabsTester.triggerTab({ tab: 'Meds' });
    expect(tabsTester.getSelectedTab()).toHaveTextContent('Meds');
    expect(tabsTester.getSelectedTab()).toHaveAttribute('aria-selected', 'true');
    await screen.findByRole('heading', { level: 2, name: 'Medications & schedule' });
    expect(screen.queryByRole('heading', { level: 2, name: 'Today' })).not.toBeInTheDocument();

    await tabsTester.triggerTab({ tab: 'Today' });
    expect(tabsTester.getSelectedTab()).toHaveTextContent('Today');
    await screen.findByRole('heading', { level: 2, name: 'Today' });
  });

  it('is keyboard-operable per the ARIA tabs pattern: arrow keys move focus and auto-activate', async () => {
    await renderReady();
    const nav = screen.getByRole('navigation');
    const keyboardTester = testUtilUser.createTester('Tabs', {
      root: nav,
      interactionType: 'keyboard',
    });

    expect(keyboardTester.getSelectedTab()).toHaveTextContent('Today');
    await keyboardTester.triggerTab({ tab: 'Calendar' });
    expect(keyboardTester.getSelectedTab()).toHaveTextContent('Calendar');
    expect(document.activeElement).toBe(keyboardTester.getSelectedTab());
    // CalendarScreen has no static "Calendar" heading (its <h2> is the day
    // label), so assert on its distinguishing day-nav controls instead.
    await screen.findByLabelText('Previous day');
  });

  // Regression guard for the "There is no tab id, please check if you have
  // rendered the tab panel before the tab list" console.error: React Aria's
  // Tabs stamps a base id onto the shared tab-list state the first time
  // <TabList> renders (via `useTabList`); each <TabPanel> reads that id
  // (via `useTabPanel`) to build its `aria-controls`/`id`. If <TabPanels> is
  // declared before <TabList> in the tree, every render/tab-switch computes
  // the panel id before the base id exists and React Aria logs a
  // console.error — this app has a zero-console-errors bar (Stage 18
  // journey evidence), so that's a real regression, not noise. <nav> (which
  // holds <TabList>) is declared before <main> (which holds <TabPanels>) in
  // App.tsx specifically to keep this id stamped first.
  it('never logs the React Aria "no tab id" error across render + several tab switches', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await renderReady();
      const nav = screen.getByRole('navigation');
      const tabsTester = testUtilUser.createTester('Tabs', { root: nav });

      for (const t of ['Calendar', 'Meds', 'Events', 'History', 'Today'] as const) {
        await tabsTester.triggerTab({ tab: t });
        expect(tabsTester.getSelectedTab()).toHaveTextContent(t);
      }

      const tabIdErrors = errorSpy.mock.calls.filter((call) =>
        String(call[0]).includes('no tab id'),
      );
      expect(tabIdErrors).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
