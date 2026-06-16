import { describe, expect, it } from 'vitest';
import { parseBackendConfig } from './config';

describe('parseBackendConfig', () => {
  it('returns null when required vars are missing (local-first default)', () => {
    expect(parseBackendConfig({})).toBeNull();
    expect(
      parseBackendConfig({ VITE_COGNITO_USER_POOL_ID: 'p', VITE_COGNITO_CLIENT_ID: 'c' }),
    ).toBeNull();
  });

  it('parses a full config and defaults the region', () => {
    const cfg = parseBackendConfig({
      VITE_COGNITO_USER_POOL_ID: 'pool',
      VITE_COGNITO_CLIENT_ID: 'client',
      VITE_API_BASE_URL: 'http://localhost:3001',
    });
    expect(cfg).toEqual({
      region: 'us-east-1',
      userPoolId: 'pool',
      clientId: 'client',
      apiBaseUrl: 'http://localhost:3001',
    });
  });

  it('includes the cognito-local endpoint when provided', () => {
    const cfg = parseBackendConfig({
      VITE_COGNITO_USER_POOL_ID: 'pool',
      VITE_COGNITO_CLIENT_ID: 'client',
      VITE_API_BASE_URL: 'http://localhost:3001',
      VITE_COGNITO_REGION: 'eu-west-2',
      VITE_COGNITO_ENDPOINT: 'http://localhost:9229',
    });
    expect(cfg?.region).toBe('eu-west-2');
    expect(cfg?.cognitoEndpoint).toBe('http://localhost:9229');
  });
});
