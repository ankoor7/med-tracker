// Singleton Supabase client. Created lazily from the backend config so the
// local-first "no backend configured" path never instantiates it. The client
// owns the GoTrue session (persisted to localStorage, auto-refreshed) and is the
// transport for both auth (src/auth/supabaseAuth.ts) and sync
// (src/sync/supabaseBackend.ts). The anon key is publishable; RLS protects data.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getBackendConfig } from '../config';

export class BackendNotConfiguredError extends Error {
  constructor() {
    super('Backend not configured');
    this.name = 'BackendNotConfiguredError';
  }
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const cfg = getBackendConfig();
    if (!cfg) throw new BackendNotConfiguredError();
    client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
