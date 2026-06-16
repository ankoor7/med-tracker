// App backend configuration. The app is local-first and fully usable with NO
// backend configured. When the Stage 3 env vars are present (local dev via
// `pnpm local:bootstrap`, or a real deploy), auth + sync become available.

export interface BackendConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  cognitoEndpoint?: string; // set for cognito-local; omitted for real AWS
  apiBaseUrl: string;
}

type RawEnv = Record<string, string | undefined>;

/** Pure parser so it can be unit-tested without import.meta. */
export function parseBackendConfig(env: RawEnv): BackendConfig | null {
  const userPoolId = env.VITE_COGNITO_USER_POOL_ID;
  const clientId = env.VITE_COGNITO_CLIENT_ID;
  const apiBaseUrl = env.VITE_API_BASE_URL;
  if (!userPoolId || !clientId || !apiBaseUrl) return null;
  return {
    region: env.VITE_COGNITO_REGION || 'us-east-1',
    userPoolId,
    clientId,
    apiBaseUrl,
    ...(env.VITE_COGNITO_ENDPOINT ? { cognitoEndpoint: env.VITE_COGNITO_ENDPOINT } : {}),
  };
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
