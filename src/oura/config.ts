// Oura integration configuration + the auth seam.
//
// AUTH IS MOCK-ONLY FOR NOW. The app ships a deterministic offline mock data
// source (see `MockOuraClient`); the live HTTP client (`HttpOuraClient`) is fully
// implemented against the documented v2 endpoints but is NOT wired to real
// OAuth/token auth. This module is the single injection point where that wiring
// lands later: provide a real `OuraAuthProvider` (a Personal Access Token now, an
// OAuth2 access-token refresh flow later) and flip `mode` to 'live'.
//
// No secrets live here or in the repo — a real token comes from the environment
// or a future auth flow at runtime, never committed.

export type OuraMode = 'mock' | 'live';

/** Default Oura API base. Overridable for tests / self-host proxies. */
export const OURA_API_BASE = 'https://api.ouraring.com';

export interface OuraConfig {
  mode: OuraMode;
  /** Live-only base URL. */
  baseUrl: string;
  /**
   * Live-only bearer token. THE AUTH SEAM: today this is unset (mock mode). When
   * real auth is wired, supply a token here (or via a refreshing OuraAuthProvider).
   */
  accessToken: string | null;
}

/**
 * Supplies the bearer token for the live client. The mock client never calls it.
 * Real auth wiring implements this (PAT lookup now; OAuth2 refresh later).
 */
export interface OuraAuthProvider {
  getAccessToken(): Promise<string | null>;
}

type RawEnv = Record<string, string | undefined>;

/**
 * Parse Oura config from env. Defaults to 'mock' so the feature works fully
 * offline with no credentials. 'live' requires `VITE_OURA_ACCESS_TOKEN`; until
 * real auth is wired this is left unset, keeping the app in mock mode.
 */
export function parseOuraConfig(env: RawEnv): OuraConfig {
  const token = env.VITE_OURA_ACCESS_TOKEN ?? null;
  const requested = env.VITE_OURA_MODE === 'live' ? 'live' : 'mock';
  // Never silently fall into a broken live mode without a token.
  const mode: OuraMode = requested === 'live' && token ? 'live' : 'mock';
  return {
    mode,
    baseUrl: env.VITE_OURA_API_BASE ?? OURA_API_BASE,
    accessToken: token,
  };
}
