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

describe('SteadyDoseStack synth (stage-3 AC1)', () => {
  const template = synth();

  it('provisions Cognito, DynamoDB, Lambda, HTTP API and CloudFront', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    template.resourceCountIs('AWS::DynamoDB::GlobalTable', 0);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('DynamoDB has the byUpdatedAt GSI, PITR and customer-managed encryption', () => {
    template.hasResourceProperties(
      'AWS::DynamoDB::Table',
      Match.objectLike({
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        SSESpecification: Match.objectLike({ SSEEnabled: true }),
        GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'byUpdatedAt' })]),
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
