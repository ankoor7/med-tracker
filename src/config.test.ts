import { describe, expect, it } from 'vitest';
import { parseBackendConfig } from './config';

describe('parseBackendConfig', () => {
  it('returns null when required vars are missing (local-first default)', () => {
    expect(parseBackendConfig({})).toBeNull();
    expect(parseBackendConfig({ VITE_SUPABASE_URL: 'http://localhost:54321' })).toBeNull();
    expect(parseBackendConfig({ VITE_SUPABASE_ANON_KEY: 'anon' })).toBeNull();
  });

  it('parses a full Supabase config', () => {
    const cfg = parseBackendConfig({
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    });
    expect(cfg).toEqual({
      supabaseUrl: 'http://localhost:54321',
      supabaseAnonKey: 'anon-key',
    });
  });
});
