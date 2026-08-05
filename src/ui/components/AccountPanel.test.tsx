import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Which branch this panel renders depends on `isBackendConfigured()`, which reads
// `import.meta.env`. Vite loads `.env.local` into that for tests as well, so these
// cases pin the config explicitly rather than inheriting whatever the developer's
// local stack left behind — `vite.config.ts` defaults unit tests to unconfigured,
// and the configured case below opts in. `config.ts` memoises the parsed config in
// module scope, hence `resetModules()` before each dynamic import.
async function renderPanel(env: { url?: string; anonKey?: string } = {}) {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', env.url ?? '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', env.anonKey ?? '');
  const { AccountPanel } = await import('./AccountPanel');
  render(<AccountPanel />);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('../../auth/supabaseAuth');
});

describe('AccountPanel', () => {
  it(
    'renders the offline copy with no backend configured (regression: useAuth used to ' +
      'call getSupabase() unconditionally, throwing BackendNotConfiguredError)',
    async () => {
      await renderPanel();
      expect(screen.getByText(/cloud sync is off/i)).toBeInTheDocument();
      // The instructions are the point of this branch — a user with no backend
      // needs to be told how to get one, not just that sync is off.
      expect(screen.getByText('supabase start')).toBeInTheDocument();
      expect(screen.getByText('pnpm local:env')).toBeInTheDocument();
    },
  );

  it('takes the account branch when a backend IS configured', async () => {
    // Stub the auth client so this asserts the panel's branching, not GoTrue's
    // behaviour: an unresolved session is what the panel shows "Checking session…"
    // for, and a real client here would reach for the network.
    vi.doMock('../../auth/supabaseAuth', () => ({
      currentAccount: () => new Promise(() => {}), // never resolves: session pending
      onAuthStateChange: () => () => {},
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    }));

    await renderPanel({ url: 'http://localhost:54321', anonKey: 'anon-key' });

    expect(screen.getByText(/checking session/i)).toBeInTheDocument();
    expect(screen.queryByText(/cloud sync is off/i)).not.toBeInTheDocument();
  });
});
