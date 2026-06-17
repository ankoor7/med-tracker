// App backend configuration. The app is local-first and fully usable with NO
// backend configured. When the Supabase env vars are present (local dev via
// `supabase start` → `.env.local`, or a real deploy), auth + sync become
// available. The anon key is publishable — Row-Level Security, not key secrecy,
// is what protects data (the service-role key is never shipped to the client).

export interface BackendConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

type RawEnv = Record<string, string | undefined>;

/** Pure parser so it can be unit-tested without import.meta. */
export function parseBackendConfig(env: RawEnv): BackendConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return { supabaseUrl, supabaseAnonKey };
}

let cached: BackendConfig | null | undefined;

export function getBackendConfig(): BackendConfig | null {
  if (cached === undefined) {
    cached = parseBackendConfig(import.meta.env as unknown as RawEnv);
  }
  return cached;
}

export function isBackendConfigured(): boolean {
  return getBackendConfig() !== null;
}
