// Cognito auth client. Wraps amazon-cognito-identity-js, pointed at cognito-local
// in dev (via the `endpoint` option) or real Cognito in production. Stage 3:
// sign up / sign in / sign out / session refresh. Tokens never include the
// passphrase; E2E keys (Stage 4) are derived separately on-device.

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  CognitoUserAttribute,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { getBackendConfig } from '../config';

export class AuthNotConfiguredError extends Error {
  constructor() {
    super('Backend not configured');
  }
}

let pool: CognitoUserPool | null = null;
function userPool(): CognitoUserPool {
  const cfg = getBackendConfig();
  if (!cfg) throw new AuthNotConfiguredError();
  if (!pool) {
    pool = new CognitoUserPool({
      UserPoolId: cfg.userPoolId,
      ClientId: cfg.clientId,
      ...(cfg.cognitoEndpoint ? { endpoint: cfg.cognitoEndpoint } : {}),
    });
  }
  return pool;
}

function cognitoUser(email: string): CognitoUser {
  return new CognitoUser({ Username: email, Pool: userPool() });
}

export interface AccountInfo {
  email: string;
}

export function signUp(email: string, password: string): Promise<void> {
  const attrs = [new CognitoUserAttribute({ Name: 'email', Value: email })];
  return new Promise((resolve, reject) => {
    userPool().signUp(email, password, attrs, [], (err) => (err ? reject(err) : resolve()));
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cognitoUser(email).confirmRegistration(code, true, (err) => (err ? reject(err) : resolve()));
  });
}

export function signIn(email: string, password: string): Promise<CognitoUserSession> {
  const user = cognitoUser(email);
  // USER_PASSWORD_AUTH avoids SRP (more reliable against cognito-local).
  user.setAuthenticationFlowType('USER_PASSWORD_AUTH');
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
    });
  });
}

export function signOut(): void {
  userPool().getCurrentUser()?.signOut();
}

export function currentAccount(): AccountInfo | null {
  const user = userPool().getCurrentUser();
  return user ? { email: user.getUsername() } : null;
}

/** Resolve a valid session, refreshing if needed. Null if signed out. */
export function getSession(): Promise<CognitoUserSession | null> {
  const user = userPool().getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      resolve(err || !session?.isValid() ? null : session);
    });
  });
}

/** A valid JWT (id token) for API calls, or null if not signed in. */
export async function getIdToken(): Promise<string | null> {
  const session = await getSession();
  return session ? session.getIdToken().getJwtToken() : null;
}
