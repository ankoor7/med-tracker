import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from 'react-aria-components';
import App from './App';

// Stage 19 FR-19.1: the app root must render inside the React Aria
// `I18nProvider` (added in src/main.tsx) without error or behaviour change —
// this mirrors the real composition instead of relying on App.smoke.test.tsx
// (which renders <App/> bare) to prove the provider itself is harmless.
describe('React Aria providers (FR-19.1)', () => {
  it('renders the app shell without error inside I18nProvider', async () => {
    render(
      <I18nProvider locale="en-US">
        <App />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('SteadyDose');
    await screen.findByRole('heading', { level: 2, name: 'Today' });
  });
});
