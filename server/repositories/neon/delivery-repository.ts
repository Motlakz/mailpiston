import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { APIError } from '@/server/core/errors';
import { newId } from '@/server/core/ids';
import type { EndpointDelivery } from '@/server/core/types';
import { db } from '@/server/db/client';
import { endpointDeliveries } from '@/server/db/schema';
import type {
  DeliveryRepository,
  EnqueueResult,
} from '@/server/repositories/types';

type DeliveryRow = typeof endpointDeliveries.$inferSelect;

const DEFAULT_LOG_LIMIT = 50;

export class NeonDeliveryRepository implements DeliveryRepository {
  /**
   * Idempotent by constraint, not by lookup-then-insert.
   *
   * `ON CONFLICT DO NOTHING` returns no row when the unique index on
   * (event, endpoint, recipient) already holds one, and that empty result is
   * the signal: exactly one of two concurrent ingests sees `created: true`, so
   * exactly one of them delivers. A read-then-write check would have a window
   * between the two statements where both callers see nothing and both deliver.
   */
  async enqueue(data: {
    endpointId: string;
    eventId: string;
    recipientId: string | null;
  }): Promise<EnqueueResult> {
    const [inserted] = await db
      .insert(endpointDeliveries)
      .values({ id: newId('delivery'), ...data })
      .onConflictDoNothing()
      .returning();

    if (inserted) return { delivery: toDelivery(inserted), created: true };

    const [existing] = await db
      .select()
      .from(endpointDeliveries)
      .where(
        and(
          eq(endpointDeliveries.eventId, data.eventId),
          eq(endpointDeliveries.endpointId, data.endpointId),
          sql`coalesce(${endpointDeliveries.recipientId}, '') = coalesce(${data.recipientId}, '')`,
        ),
      )
      .limit(1);

    if (!existing) {
      // The insert conflicted, so a row matching the index exists. Failing to
      // read it back means the index and this query disagree about identity,
      // which would silently drop deliveries rather than duplicate them.
      throw new APIError(
        'Delivery conflicted on insert but could not be read back',
        500,
        'DELIVERY_LOOKUP_FAILED',
      );
    }

    return { delivery: toDelivery(existing), created: false };
  }

  async findById(id: string): Promise<EndpointDelivery | null> {
    const [row] = await db
      .select()
      .from(endpointDeliveries)
      .where(eq(endpointDeliveries.id, id))
      .limit(1);

    return row ? toDelivery(row) : null;
  }

  /**
   * The atomic claim lands with the retry engine (roadmap Phase 8).
   *
   * Phase 7 needs no lease: `enqueue` already elects a single deliverer for the
   * synchronous first attempt. A half-built claim that looked usable would be
   * the more dangerous thing to leave lying around.
   */
  claim(): Promise<EndpointDelivery | null> {
    throw new APIError(
      'DeliveryRepository.claim is not implemented yet — lands in Phase 8 (retries)',
      501,
      'NOT_IMPLEMENTED',
    );
  }

  async markDelivered(id: string, responseCode: number): Promise<void> {
    await db
      .update(endpointDeliveries)
      .set({
        status: 'delivered',
        // Incremented in SQL rather than read-modify-written: the attempt count
        // must stay correct even if two paths ever record the same delivery.
        attempt: sql`${endpointDeliveries.attempt} + 1`,
        responseCode,
        lastError: null,
        deliveredAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(endpointDeliveries.id, id));
  }

  async markFailed(
    id: string,
    responseCode: number | null,
    error: string,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    await db
      .update(endpointDeliveries)
      .set({
        // `pending` while another attempt is owed, `failed` once the schedule
        // is exhausted. The two are told apart by whether a time was given, so
        // a caller cannot record "give up" and "try again at" together.
        status: nextAttemptAt ? 'pending' : 'failed',
        attempt: sql`${endpointDeliveries.attempt} + 1`,
        responseCode,
        // Truncated: a downstream 500 page can be an entire HTML document, and
        // the useful part is always at the front.
        lastError: error.slice(0, 2000),
        nextAttemptAt: nextAttemptAt ?? new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(endpointDeliveries.id, id));
  }

  async listForEvent(eventId: string): Promise<EndpointDelivery[]> {
    const rows = await db
      .select()
      .from(endpointDeliveries)
      .where(eq(endpointDeliveries.eventId, eventId))
      .orderBy(desc(endpointDeliveries.createdAt));

    return rows.map(toDelivery);
  }

  async listForEndpoint(
    endpointId: string,
    limit = DEFAULT_LOG_LIMIT,
  ): Promise<EndpointDelivery[]> {
    const rows = await db
      .select()
      .from(endpointDeliveries)
      .where(eq(endpointDeliveries.endpointId, endpointId))
      .orderBy(desc(endpointDeliveries.createdAt))
      .limit(limit);

    return rows.map(toDelivery);
  }
}

function toDelivery(row: DeliveryRow): EndpointDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventId: row.eventId,
    recipientId: row.recipientId,
    status: row.status,
    attempt: row.attempt,
    responseCode: row.responseCode,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
