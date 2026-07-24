import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountPanel } from './AccountPanel';

describe('AccountPanel — no backend configured', () => {
  it(
    'renders the offline copy without throwing (regression: useAuth used to call ' +
      'getSupabase() unconditionally, throwing BackendNotConfiguredError)',
    () => {
      render(<AccountPanel />);
      expect(screen.getByText(/cloud sync is off/i)).toBeInTheDocument();
    },
  );
});
