/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  // Backend config (Stage 3+). Empty in pure local-first mode; populated by
  // `pnpm local:bootstrap` (local) or the deploy config generator (real AWS).
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_REGION?: string;
  readonly VITE_COGNITO_ENDPOINT?: string; // set for cognito-local
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
