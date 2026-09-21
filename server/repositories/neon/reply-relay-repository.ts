import 'server-only';

import { and, eq } from 'drizzle-orm';

import { newId } from '@/server/core/ids';
import type { ReplyRelay } from '@/server/core/types';
import { db } from '@/server/db/client';
import { replyRelays } from '@/server/db/schema';
import type { ReplyRelayRepository } from '@/server/repositories/types';

type RelayRow = typeof replyRelays.$inferSelect;

/**
 * Reply-relay tokens (§4.4A).
 *
 * Only the hash is stored, and lookup is *by* the hash — so a leaked table
 * yields nothing that can be put in a `To:`, and the query is an index probe
 * rather than a scan comparing secrets one row at a time.
 *
 * Tenant-scoped like every other repository: the instance is bound to one
 * tenant at construction and every statement carries that filter. A token is
 * already unguessable, so the extra predicate is not what makes the lookup
 * safe — it is there so that no query in this file can *ever* reach another
 * tenant's row, whatever is passed to it.
 */
export class NeonReplyRelayRepository implements ReplyRelayRepository {
  constructor(private readonly tenantId: string) {}

  async create(data: {
    tokenHash: string;
    addressId: string;
    threadId: string;
    endpointEmailRecipientId: string;
    expiresAt: Date | null;
  }): Promise<ReplyRelay> {
    const [row] = await db
      .insert(replyRelays)
      .values({ id: newId('relay'), tenantId: this.tenantId, ...data })
      .returning();

    return toRelay(row);
  }

  async findByTokenHash(tokenHash: string): Promise<ReplyRelay | null> {
    const [row] = await db
      .select()
      .from(replyRelays)
      .where(
        and(
          eq(replyRelays.tenantId, this.tenantId),
          eq(replyRelays.tokenHash, tokenHash),
        ),
      )
      .limit(1);

    return row ? toRelay(row) : null;
  }

  async revoke(id: string): Promise<void> {
    await db
      .update(replyRelays)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(replyRelays.tenantId, this.tenantId), eq(replyRelays.id, id)),
      );
  }
}

function toRelay(row: RelayRow): ReplyRelay {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    addressId: row.addressId,
    threadId: row.threadId,
    endpointEmailRecipientId: row.endpointEmailRecipientId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
