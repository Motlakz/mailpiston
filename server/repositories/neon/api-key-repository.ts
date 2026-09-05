import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { NotFoundError } from '@/server/core/errors';
import { newId } from '@/server/core/ids';
import type { ApiKey } from '@/server/core/types';
import { db } from '@/server/db/client';
import { apiKeys } from '@/server/db/schema';
import type { ApiKeyRepository } from '@/server/repositories/types';

type ApiKeyRow = typeof apiKeys.$inferSelect;

export class NeonApiKeyRepository implements ApiKeyRepository {
  async create(data: {
    name: string;
    keyHash: string;
    keyPrefix: string;
    expiresAt: Date | null;
  }): Promise<ApiKey> {
    const [row] = await db
      .insert(apiKeys)
      .values({ id: newId('apiKey'), ...data })
      .returning();

    return toApiKey(row);
  }

  async list(): Promise<ApiKey[]> {
    const rows = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
    return rows.map(toApiKey);
  }

  /**
   * Revocation is a timestamp, not a delete: an audit trail that loses the key
   * a request used is not an audit trail.
   */
  async revoke(id: string): Promise<void> {
    const [row] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, id))
      .returning({ id: apiKeys.id });

    if (!row) throw new NotFoundError(`API key ${id} not found`);
  }
}

/** Never returns the hash: nothing above this layer has a use for it. */
function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
