import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App shell (smoke)', () => {
  it('renders the title and the five tabs', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('SteadyDose');
    for (const tab of ['Today', 'Calendar', 'Meds', 'Events', 'History']) {
      expect(screen.getByRole('button', { name: tab })).toBeInTheDocument();
    }
    // The Schedule tab was merged into Meds (FR-18.12) — no dead tab remains.
    expect(screen.queryByRole('button', { name: 'Schedule' })).not.toBeInTheDocument();
    // Wait for first-run hydration/seed so the async state update settles.
    await screen.findByRole('heading', { level: 2, name: 'Today' });
  });
});
