// Local dev configuration — fixed endpoints/names for the Docker containers,
// plus read/write of the bootstrap-generated local-config.json (gitignored).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const LOCAL = {
  region: 'us-east-1',
  ddbEndpoint: 'http://localhost:4566', // LocalStack
  cognitoEndpoint: 'http://localhost:9229', // cognito-local
  tableName: 'steadydose-sync',
  userPoolName: 'steadydose-local',
  appClientName: 'steadydose-web',
  apiPort: 3001,
  // Local-only throwaway dev account created by bootstrap. NOT a secret.
  devUser: { email: 'dev@steadydose.local', password: 'DevPassw0rd!' },
} as const;

export interface LocalConfig {
  userPoolId: string;
  clientId: string;
  issuer: string; // http://localhost:9229/<userPoolId>
  tableName: string;
  region: string;
  ddbEndpoint: string;
  cognitoEndpoint: string;
  apiPort: number;
}

export const LOCAL_CONFIG_PATH = join(here, 'local-config.json');

export function writeLocalConfig(cfg: LocalConfig): void {
  writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

export function readLocalConfig(): LocalConfig {
  if (!existsSync(LOCAL_CONFIG_PATH)) {
    throw new Error(
      `Missing ${LOCAL_CONFIG_PATH}. Run "pnpm local:up" then "pnpm local:bootstrap" first.`,
    );
  }
  return JSON.parse(readFileSync(LOCAL_CONFIG_PATH, 'utf8')) as LocalConfig;
}

/** Path to the repo-root .env.local that the Vite app reads. */
export const ENV_LOCAL_PATH = join(here, '..', '..', '.env.local');
