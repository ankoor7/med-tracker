// DynamoDB implementation of the SyncStore port.
// Table: PK=userId, SK=id. GSI `byUpdatedAt`: PK=userId, SK=updatedAt (incremental
// pulls). GSI `byType`: PK=userId, SK=type (type-scoped server queries, Stage 4+).
// `type` is a top-level attribute and `payload` a native DynamoDB map — the item
// is readable, not ciphertext. Works against real DynamoDB and LocalStack.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import type { SyncRecord, SyncStore } from './types';

export const UPDATED_AT_INDEX = 'byUpdatedAt';
export const TYPE_INDEX = 'byType';

interface StoredItem extends SyncRecord {
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

  async querySince(userId: string, since: number): Promise<SyncRecord[]> {
    const out: SyncRecord[] = [];
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
        out.push(toRecord(item));
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return out;
  }

  async putIfNewer(userId: string, rec: SyncRecord): Promise<boolean> {
    const item: StoredItem = {
      userId,
      id: rec.id,
      type: rec.type,
      updatedAt: rec.updatedAt,
      version: rec.version,
      payload: rec.payload,
      ...(rec.deleted ? { deleted: true } : {}),
    };
    try {
      await this.doc.put({
        TableName: this.tableName,
        Item: item,
        // Last-write-wins on (updatedAt, version): accept if new, strictly later,
        // or same instant with a higher version. Mirrors `isNewerRecord` (the
        // client merge + in-memory store use the identical predicate).
        ConditionExpression:
          'attribute_not_exists(id) OR updatedAt < :u OR (updatedAt = :u AND version < :v)',
        ExpressionAttributeValues: { ':u': rec.updatedAt, ':v': rec.version },
      });
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }
}

function toRecord(item: StoredItem): SyncRecord {
  return {
    id: item.id,
    type: item.type,
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
