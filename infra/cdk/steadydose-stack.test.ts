import { describe, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SteadyDoseStack } from './steadydose-stack';

function synth(): Template {
  // Skip asset bundling (esbuild) — we only assert on the CloudFormation shape.
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new SteadyDoseStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'eu-west-2' },
  });
  return Template.fromStack(stack);
}

describe('SteadyDoseStack synth (stage-3 AC1, stage-4 hardening)', () => {
  const template = synth();

  it('provisions Cognito, DynamoDB, Lambda, HTTP API and CloudFront', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    template.resourceCountIs('AWS::DynamoDB::GlobalTable', 0);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('DynamoDB has byUpdatedAt + byType GSIs, PITR and customer-managed encryption', () => {
    template.hasResourceProperties(
      'AWS::DynamoDB::Table',
      Match.objectLike({
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        SSESpecification: Match.objectLike({ SSEEnabled: true }),
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({ IndexName: 'byUpdatedAt' }),
          Match.objectLike({ IndexName: 'byType' }),
        ]),
      }),
    );
  });

  it('hardens Cognito: strong password policy + optional TOTP MFA (AC5)', () => {
    template.hasResourceProperties(
      'AWS::Cognito::UserPool',
      Match.objectLike({
        MfaConfiguration: 'OPTIONAL',
        EnabledMfas: Match.arrayWith(['SOFTWARE_TOKEN_MFA']),
        Policies: Match.objectLike({
          PasswordPolicy: Match.objectLike({
            MinimumLength: 12,
            RequireUppercase: true,
            RequireSymbols: true,
            RequireNumbers: true,
            RequireLowercase: true,
          }),
        }),
      }),
    );
  });

  it('serves the app with HSTS over HTTPS (AC4 — TLS in transit)', () => {
    template.hasResourceProperties(
      'AWS::CloudFront::ResponseHeadersPolicy',
      Match.objectLike({
        ResponseHeadersPolicyConfig: Match.objectLike({
          SecurityHeadersConfig: Match.objectLike({
            StrictTransportSecurity: Match.objectLike({
              AccessControlMaxAgeSec: 31536000,
              IncludeSubdomains: true,
            }),
          }),
        }),
      }),
    );
  });

  it('exposes /sync/pull and /sync/push behind a JWT authorizer', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 2);
    template.hasResourceProperties(
      'AWS::ApiGatewayV2::Authorizer',
      Match.objectLike({ AuthorizerType: 'JWT' }),
    );
  });

  it('runs the sync handler on Node 20', () => {
    template.hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({ Runtime: 'nodejs20.x' }),
    );
  });

  it('keeps the site bucket private (no public access)', () => {
    template.hasResourceProperties(
      'AWS::S3::Bucket',
      Match.objectLike({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      }),
    );
  });
});
