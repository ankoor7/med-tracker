// SteadyDose backend — one CDK stack, deployable to a fresh AWS account.
// See specs/02-architecture.md §9 and stage-3 §5. The cloud is NOT zero-knowledge:
// DynamoDB stores readable records (opaque pass-through at Stage 3, typed +
// server-validated from Stage 4), protected by KMS at rest and a JWT authorizer
// that isolates by user.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
  TableEncryption,
} from 'aws-cdk-lib/aws-dynamodb';
import { Key } from 'aws-cdk-lib/aws-kms';
import { AccountRecovery, OAuthScope, UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import type { Construct } from 'constructs';

const here = dirname(fileURLToPath(import.meta.url));
export const UPDATED_AT_INDEX = 'byUpdatedAt';

export class SteadyDoseStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- Encryption key (primary at-rest protection for readable records) -----
    const key = new Key(this, 'DataKey', {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
      description: 'SteadyDose DynamoDB at-rest encryption',
    });

    // --- DynamoDB: per-user records (readable; SSE-KMS at rest) ---------------
    const table = new Table(this, 'SyncTable', {
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: UPDATED_AT_INDEX,
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: AttributeType.NUMBER },
      projectionType: ProjectionType.ALL,
    });

    // --- Cognito: per-user auth ------------------------------------------------
    const userPool = new UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
      passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true },
    });
    const userPoolClient = new UserPoolClient(this, 'WebClient', {
      userPool,
      authFlows: { userPassword: true, userSrp: true },
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [OAuthScope.OPENID] },
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // --- Lambda sync handler ---------------------------------------------------
    const syncFn = new NodejsFunction(this, 'SyncHandler', {
      runtime: Runtime.NODEJS_20_X,
      entry: join(here, '..', 'lambda', 'index.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(15),
      environment: { TABLE_NAME: table.tableName },
      bundling: {
        format: OutputFormat.ESM,
        externalModules: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
      },
    });
    table.grantReadWriteData(syncFn);

    // --- HTTP API with Cognito JWT authorizer ---------------------------------
    const authorizer = new HttpJwtAuthorizer(
      'JwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );
    const httpApi = new HttpApi(this, 'SyncApi', {
      corsPreflight: {
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowOrigins: ['*'],
      },
    });
    const integration = new HttpLambdaIntegration('SyncIntegration', syncFn);
    for (const path of ['/sync/pull', '/sync/push']) {
      httpApi.addRoutes({ path, methods: [HttpMethod.POST], integration, authorizer });
    }

    // --- Static hosting: private S3 + CloudFront (OAC) ------------------------
    const siteBucket = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const distribution = new Distribution(this, 'SiteDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      // SPA fallback so client-side routes resolve.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    // --- Outputs (consumed by the app-config generator) -----------------------
    new CfnOutput(this, 'Region', { value: this.region });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'ApiBaseUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
    });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
  }
}
