// Generate the frontend's .env.production from CDK stack outputs after a deploy.
// Usage (via `pnpm infra:gen-config`), expects cdk-outputs.json from:
//   cdk deploy --outputs-file cdk-outputs.json
//
// No secrets here — these are public resource identifiers (pool/client ids,
// API URL). Auth secrets never exist (public client, E2E keys stay on-device).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUTS_PATH = join(root, 'cdk-outputs.json');
const ENV_PROD_PATH = join(root, '.env.production');
const STACK = 'SteadyDoseStack';

interface StackOutputs {
  Region?: string;
  UserPoolId?: string;
  UserPoolClientId?: string;
  ApiBaseUrl?: string;
  DistributionDomainName?: string;
}

function main(): void {
  if (!existsSync(OUTPUTS_PATH)) {
    throw new Error(`Missing ${OUTPUTS_PATH}. Run: cdk deploy --outputs-file cdk-outputs.json`);
  }
  const all = JSON.parse(readFileSync(OUTPUTS_PATH, 'utf8')) as Record<string, StackOutputs>;
  const out = all[STACK];
  if (!out) throw new Error(`No outputs for stack ${STACK} in ${OUTPUTS_PATH}`);

  for (const key of ['Region', 'UserPoolId', 'UserPoolClientId', 'ApiBaseUrl'] as const) {
    if (!out[key]) throw new Error(`Stack output ${key} missing`);
  }

  const lines = [
    '# Generated from CDK outputs by `pnpm infra:gen-config`. Do not commit.',
    `VITE_API_BASE_URL=${out.ApiBaseUrl}`,
    `VITE_COGNITO_USER_POOL_ID=${out.UserPoolId}`,
    `VITE_COGNITO_CLIENT_ID=${out.UserPoolClientId}`,
    `VITE_COGNITO_REGION=${out.Region}`,
    '# (no VITE_COGNITO_ENDPOINT for real AWS)',
    '',
  ];
  writeFileSync(ENV_PROD_PATH, lines.join('\n'));
  console.log(`Wrote ${ENV_PROD_PATH}`);
  if (out.DistributionDomainName) {
    console.log(`App will be hosted at https://${out.DistributionDomainName}`);
  }
}

main();
