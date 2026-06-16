import { useCallback, useEffect, useState } from 'react';
import {
  currentAccount,
  getSession,
  signIn as cognitoSignIn,
  signOut as cognitoSignOut,
  signUp as cognitoSignUp,
  type AccountInfo,
} from './cognito';

export interface UseAuth {
  ready: boolean;
  account: AccountInfo | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

/** React binding for the Cognito auth client. */
export function useAuth(): UseAuth {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const session = await getSession().catch(() => null);
      if (live) {
        setAccount(session ? currentAccount() : null);
        setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await cognitoSignIn(email, password);
    setAccount(currentAccount());
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await cognitoSignUp(email, password);
  }, []);

  const signOut = useCallback(() => {
    cognitoSignOut();
    setAccount(null);
  }, []);

  return { ready, account, signIn, signUp, signOut };
}
