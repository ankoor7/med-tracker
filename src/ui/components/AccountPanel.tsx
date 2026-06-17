import { useState } from 'react';
import { isBackendConfigured } from '../../config';
import { useAuth } from '../../auth/useAuth';
import { useSync } from '../../sync/useSync';
import { Button, Card, Field, inputClass } from './ui';
import { SyncIndicator } from './SyncIndicator';

// Account & sync panel. The app is local-first, so this is optional: with no
// backend configured it explains how to enable it; otherwise it provides
// sign-in/up/out and a quick authorized-API check (full sync lands in Stage 5).
export function AccountPanel() {
  const configured = isBackendConfigured();
  const { ready, account, signIn, signUp, signOut } = useAuth();
  const { status, syncNow } = useSync(configured && !!account);

  const [email, setEmail] = useState('dev@steadydose.local');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <Card>
        <h3 className="mb-2 text-sm font-medium">Account &amp; sync</h3>
        <p className="text-sm text-slate-400">
          Cloud sync is off — the app works fully offline. To enable it locally, run{' '}
          <code className="rounded bg-slate-800 px-1">supabase start</code> then{' '}
          <code className="rounded bg-slate-800 px-1">pnpm local:env</code>, or point it at your own
          Supabase project.
        </p>
      </Card>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === 'up') {
        await signUp(email, password);
        setMessage('Account created — you can sign in now.');
        setMode('in');
      } else {
        await signIn(email, password);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">Account &amp; sync</h3>
        {account && <SyncIndicator status={status} />}
      </div>

      {!ready ? (
        <p className="text-sm text-slate-400">Checking session…</p>
      ) : account ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Signed in as <span className="font-medium">{account.email}</span>
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => void syncNow()}
              disabled={busy || status.phase === 'syncing'}
            >
              Sync now
            </Button>
            <Button variant="ghost" onClick={signOut} disabled={busy}>
              Sign out
            </Button>
          </div>
          {status.rejections.length > 0 && (
            <p className="text-xs text-status-missed">
              {status.rejections.length} record(s) rejected by the server:{' '}
              {status.rejections.map((r) => r.reason ?? 'invalid').join('; ')}
            </p>
          )}
          {status.phase === 'error' && status.error && (
            <p className="text-xs text-status-missed">Sync error: {status.error}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email"
            />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Password"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={busy || !email || !password}>
              {mode === 'in' ? 'Sign in' : 'Sign up'}
            </Button>
            <button
              type="button"
              className="text-xs text-slate-400 underline hover:text-slate-200"
              onClick={() => {
                setMode(mode === 'in' ? 'up' : 'in');
                setError(null);
                setMessage(null);
              }}
            >
              {mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-2 text-xs text-status-taken">{message}</p>}
      {error && <p className="mt-2 text-xs text-status-missed">{error}</p>}
    </Card>
  );
}
