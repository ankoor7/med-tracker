// Lambda sync handler — API Gateway HTTP API (v2) adapter over the shared
// handler-core. The HTTP API JWT authorizer has already validated the token;
// we read the user id from the verified claims (never from the request body).
// Stage 3: opaque pass-through envelopes. Stage 4 adds the readable, typed record
// model + server-side validation (the cloud is not zero-knowledge); Stage 5 the
// full sync engine.

import { BadRequestError, handlePull, handlePush } from '../sync/handlerCore';
import { DynamoDbSyncStore } from '../sync/dynamoStore';
import type { SyncStore } from '../sync/types';

// Minimal structural types for the API Gateway v2 proxy event/result, so we
// don't pull in @types/aws-lambda just for two shapes.
interface ApiGatewayV2Event {
  rawPath?: string;
  requestContext: {
    http?: { method?: string; path?: string };
    authorizer?: { jwt?: { claims?: Record<string, string | number | boolean> } };
  };
  body?: string | null;
  isBase64Encoded?: boolean;
}

interface ApiGatewayV2Result {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

const TABLE_NAME = process.env.TABLE_NAME ?? '';
let store: SyncStore | undefined;
function getStore(): SyncStore {
  if (!store) store = new DynamoDbSyncStore(TABLE_NAME);
  return store;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export async function handler(event: ApiGatewayV2Event): Promise<ApiGatewayV2Result> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub;
  if (typeof userId !== 'string' || userId.length === 0) {
    return json(401, { error: 'unauthorized' });
  }

  const path = event.requestContext.http?.path ?? event.rawPath ?? '';
  let body: unknown;
  try {
    body = parseBody(event);
  } catch {
    return json(400, { error: 'invalid JSON body' });
  }

  try {
    if (path.endsWith('/sync/pull')) {
      return json(200, await handlePull(getStore(), userId, body as never));
    }
    if (path.endsWith('/sync/push')) {
      return json(200, await handlePush(getStore(), userId, body as never));
    }
    return json(404, { error: 'not found' });
  } catch (err) {
    if (err instanceof BadRequestError) return json(400, { error: err.message });
    console.error('sync handler error', err);
    return json(500, { error: 'internal error' });
  }
}

function parseBody(event: ApiGatewayV2Event): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  return JSON.parse(raw);
}

function json(statusCode: number, payload: unknown): ApiGatewayV2Result {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}
