// Supabase (GoTrue) auth client. Re-implements the exact surface `useAuth`
// already consumed from the old Cognito module, so the hook only changes its
// import path. The cloud is server-readable (not zero-knowledge): there are no
// client-held data keys — auth is the GoTrue session only, persisted and
// auto-refreshed by the supabase-js client.
//
// Email confirmation is disabled in local/single-user config (D2 = i), so
// `signUp` yields a usable account immediately. `getIdToken` returns the GoTrue
// access token (a JWT) — its `sub` drives `auth.uid()` in Postgres RLS + the
// push RPC. `confirmSignUp` is intentionally gone: GoTrue uses an email link,
// not a Cognito-style code, and the AccountPanel no longer surfaces a code step.

import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '../supabase/client';

export class AuthNotConfiguredError extends Error {
  constructor() {
    super('Backend not configured');
    this.name = 'AuthNotConfiguredError';
  }
}

export interface AccountInfo {
  email: string;
}

export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signUp({ email, password });
  if (error) throw error;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error('Sign-in returned no session');
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

/** Resolve the current session, refreshing if needed. Null if signed out. */
export async function getSession(): Promise<Session | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session ?? null;
}

export async function currentAccount(): Promise<AccountInfo | null> {
  const session = await getSession();
  const email = session?.user.email;
  return email ? { email } : null;
}

/** A valid JWT (GoTrue access token) for API calls, or null if not signed in. */
export async function getIdToken(): Promise<string | null> {
  const session = await getSession();
  return session?.access_token ?? null;
}

/**
 * Subscribe to auth state changes (sign-in, sign-out, token refresh). Returns an
 * unsubscribe function. Lets `useAuth` react to GoTrue's automatic refresh
 * instead of the manual Cognito refresh dance.
 */
export function onAuthStateChange(cb: (account: AccountInfo | null) => void): () => void {
  const {
    data: { subscription },
  } = getSupabase().auth.onAuthStateChange((_event, session) => {
    const email = session?.user.email;
    cb(email ? { email } : null);
  });
  return () => subscription.unsubscribe();
}
