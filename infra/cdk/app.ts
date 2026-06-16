#!/usr/bin/env node
// CDK app entry. Deploy with `pnpm cdk:deploy` (real AWS, uses your local
// credential chain — no secrets in code). Account/region come from the
// environment / CDK context.

import { App } from 'aws-cdk-lib';
import { SteadyDoseStack } from './steadydose-stack';

const app = new App();
new SteadyDoseStack(app, 'SteadyDoseStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'SteadyDose per-user backend (Cognito, HTTP API, Lambda, DynamoDB, S3+CloudFront).',
});
