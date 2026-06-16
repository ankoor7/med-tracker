// DynamoDB implementation of the SyncStore port.
// Table: PK=userId, SK=id. GSI `byUpdatedAt`: PK=userId, SK=updatedAt.
// Works against real DynamoDB and against LocalStack (just a different endpoint).

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import type { Envelope, SyncStore } from './types';

export const UPDATED_AT_INDEX = 'byUpdatedAt';

interface StoredItem extends Envelope {
  userId: string;
}

export interface DynamoStoreOptions {
  tableName: string;
  /** Override endpoint/region/creds for LocalStack. */
  endpoint?: string;
  region?: string;
}

export class DynamoDbSyncStore implements SyncStore {
  private readonly doc: DynamoDBDocument;

  constructor(
    private readonly tableName: string,
    doc?: DynamoDBDocument,
    opts?: Omit<DynamoStoreOptions, 'tableName'>,
  ) {
    if (doc) {
      this.doc = doc;
    } else {
      const client = new DynamoDBClient({
        ...(opts?.region ? { region: opts.region } : {}),
        ...(opts?.endpoint ? { endpoint: opts.endpoint } : {}),
      });
      this.doc = DynamoDBDocument.from(client, {
        marshallOptions: { removeUndefinedValues: true },
      });
    }
  }

  async querySince(userId: string, since: number): Promise<Envelope[]> {
    const out: Envelope[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.query({
        TableName: this.tableName,
        IndexName: UPDATED_AT_INDEX,
        KeyConditionExpression: 'userId = :u AND updatedAt > :since',
        ExpressionAttributeValues: { ':u': userId, ':since': since },
        ScanIndexForward: true,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      });
      for (const item of (res.Items ?? []) as StoredItem[]) {
        out.push(toEnvelope(item));
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return out;
  }

  async putIfNewer(userId: string, env: Envelope): Promise<boolean> {
    const item: StoredItem = {
      userId,
      id: env.id,
      updatedAt: env.updatedAt,
      version: env.version,
      payload: env.payload,
      ...(env.deleted ? { deleted: true } : {}),
    };
    try {
      await this.doc.put({
        TableName: this.tableName,
        Item: item,
        // Accept only if new or strictly newer.
        ConditionExpression: 'attribute_not_exists(id) OR version < :v',
        ExpressionAttributeValues: { ':v': env.version },
      });
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }
}

function toEnvelope(item: StoredItem): Envelope {
  return {
    id: item.id,
    updatedAt: item.updatedAt,
    version: item.version,
    payload: item.payload,
    ...(item.deleted ? { deleted: true } : {}),
  };
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'ConditionalCheckFailedException'
  );
}
