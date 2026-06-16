// Publish the built PWA to S3 and invalidate CloudFront, using the deployer's
// AWS CLI credentials. Run after `pnpm build`. Reads cdk-outputs.json.
//   pnpm deploy:host
//
// Uses the AWS CLI (a documented prerequisite) so we add no SDK deps here.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUTS_PATH = join(root, 'cdk-outputs.json');
const DIST = join(root, 'dist');
const STACK = 'SteadyDoseStack';

function run(cmd: string, args: string[]): void {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function main(): void {
  if (!existsSync(OUTPUTS_PATH)) throw new Error('Run cdk:deploy first (cdk-outputs.json missing)');
  if (!existsSync(DIST)) throw new Error('Run `pnpm build` first (dist/ missing)');

  const outputs = JSON.parse(readFileSync(OUTPUTS_PATH, 'utf8')) as Record<
    string,
    { SiteBucketName?: string; DistributionId?: string }
  >;
  const out = outputs[STACK];
  const bucket = out?.SiteBucketName;
  const distId = out?.DistributionId;
  if (!bucket || !distId) throw new Error('SiteBucketName / DistributionId missing from outputs');

  run('aws', ['s3', 'sync', DIST, `s3://${bucket}`, '--delete']);
  run('aws', ['cloudfront', 'create-invalidation', '--distribution-id', distId, '--paths', '/*']);
  console.log('Published.');
}

main();
