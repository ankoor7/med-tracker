import { useCallback, useEffect, useState } from 'react';
import { isBackendConfigured } from '../config';
import {
  currentAccount,
  onAuthStateChange,
  signIn as supabaseSignIn,
  signOut as supabaseSignOut,
  signUp as supabaseSignUp,
  type AccountInfo,
} from './supabaseAuth';

export interface UseAuth {
  ready: boolean;
  account: AccountInfo | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

/** React binding for the Supabase (GoTrue) auth client. */
export function useAuth(): UseAuth {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [ready, setReady] = useState(false);

  // Resolve the initial session, then let GoTrue drive subsequent changes
  // (sign-in/out and automatic token refresh) via onAuthStateChange. Skipped
  // entirely when no backend is configured, since getSupabase() throws in
  // that case (AccountPanel already renders its own "sync is off" copy).
  useEffect(() => {
    if (!isBackendConfigured()) {
      setReady(true);
      return;
    }
    let live = true;
    void (async () => {
      const acct = await currentAccount().catch(() => null);
      if (live) {
        setAccount(acct);
        setReady(true);
      }
    })();
    const unsub = onAuthStateChange((acct) => {
      if (live) setAccount(acct);
    });
    return () => {
      live = false;
      unsub();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await supabaseSignIn(email, password);
    // onAuthStateChange also fires, but set eagerly so callers see it immediately.
    setAccount(await currentAccount());
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await supabaseSignUp(email, password);
  }, []);

  const signOut = useCallback(() => {
    void supabaseSignOut();
    setAccount(null);
  }, []);

  return { ready, account, signIn, signUp, signOut };
}
