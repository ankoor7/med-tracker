// Local sync API server — the dev-time stand-in for API Gateway + Lambda.
// Reuses the exact handler-core; verifies cognito-local JWTs; reads/writes the
// DynamoDB table on LocalStack. Run with: pnpm local:api
//
// This mirrors production behaviour (JWT-authorised, per-user-isolated /sync/*)
// without needing real AWS.

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { BadRequestError, handlePull, handlePush } from '../sync/handlerCore';
import { DynamoDbSyncStore } from '../sync/dynamoStore';
import { UnauthorizedError, authenticate, cognitoLocalJwks } from './auth';
import { LOCAL, readLocalConfig } from './config';

const cfg = readLocalConfig();

const store = new DynamoDbSyncStore(cfg.tableName, undefined, {
  endpoint: cfg.ddbEndpoint,
  region: cfg.region,
});
const jwks = cognitoLocalJwks(cfg.issuer);

// cognito-local credentials for the AWS SDK (LocalStack accepts any creds).
process.env.AWS_ACCESS_KEY_ID ??= 'test';
process.env.AWS_SECRET_ACCESS_KEY ??= 'test';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Attach the authenticated user id, or 401.
async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = await authenticate(req.header('authorization'), jwks, { issuer: cfg.issuer });
    (req as Request & { userId: string }).userId = userId;
    next();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next(err);
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/sync/pull', requireUser, async (req, res, next) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    res.json(await handlePull(store, userId, req.body));
  } catch (err) {
    next(err);
  }
});

app.post('/sync/push', requireUser, async (req, res, next) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    res.json(await handlePush(store, userId, req.body));
  } catch (err) {
    next(err);
  }
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof BadRequestError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error('server error', err);
  res.status(500).json({ error: 'internal error' });
});

app.listen(cfg.apiPort, () => {
  console.log(`SteadyDose local sync API on http://localhost:${cfg.apiPort}`);
  console.log(`  DynamoDB : ${cfg.ddbEndpoint} (table ${cfg.tableName})`);
  console.log(`  Auth     : ${cfg.issuer}`);
  console.log(`  Dev user : ${LOCAL.devUser.email} / ${LOCAL.devUser.password}`);
});
