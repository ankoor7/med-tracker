import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App shell (smoke)', () => {
  it('renders the title and four tab placeholders', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('SteadyDose');
    for (const tab of ['Today', 'Schedule', 'Meds', 'History']) {
      expect(screen.getByRole('button', { name: tab })).toBeInTheDocument();
    }
    // Wait for first-run hydration/seed so the async state update settles.
    await screen.findByRole('heading', { level: 2, name: 'Today' });
  });
});
