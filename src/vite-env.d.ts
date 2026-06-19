/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  // Supabase backend config. Empty in pure local-first mode; populated by
  // `pnpm local:env` (local stack) or your Supabase project's API settings.
  // The anon key is publishable — RLS protects data.
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  // Web Push (Stage 6 follow-up). Public VAPID key for background push; the
  // matching private key is a server-only secret on the send-push Edge Function.
  // Absent → background push is off and the app uses in-app catch-up instead.
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
