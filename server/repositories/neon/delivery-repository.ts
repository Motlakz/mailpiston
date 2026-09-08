import 'server-only';

import { and, desc, eq, lt, or, sql } from 'drizzle-orm';

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
   * The atomic state transition from plan §15.5.
   *
   * One statement, so there is no window between deciding a row is claimable
   * and claiming it. Whoever gets the row back owns the attempt; everyone else
   * gets `null` and stops. That is what stops two Inngest executions, or an
   * Inngest execution and an operator's manual retry, from delivering the same
   * event twice.
   *
   * The expired-lease branch is the difference between this and the plan's
   * version. A function that dies mid-attempt leaves the row `delivering` with
   * a lease nobody holds, and without that branch the delivery is stuck there
   * permanently — no retry can touch it, and the log shows it perpetually in
   * flight.
   */
  async claim(
    id: string,
    leaseOwner: string,
    leaseMs: number,
  ): Promise<EndpointDelivery | null> {
    const now = new Date();

    const [row] = await db
      .update(endpointDeliveries)
      .set({
        status: 'delivering',
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      })
      .where(
        and(
          eq(endpointDeliveries.id, id),
          or(
            eq(endpointDeliveries.status, 'pending'),
            and(
              eq(endpointDeliveries.status, 'delivering'),
              lt(endpointDeliveries.leaseExpiresAt, now),
            ),
          ),
        ),
      )
      .returning();

    return row ? toDelivery(row) : null;
  }

  /**
   * Puts a delivery back in the queue, due now.
   *
   * Accepts `failed` — the whole point of a manual retry — and `pending`, which
   * covers a delivery whose scheduled event was lost. It does not accept
   * `delivered`: re-sending a webhook the receiver already acknowledged is not
   * a retry, it is a duplicate.
   */
  async requeue(id: string): Promise<EndpointDelivery | null> {
    const now = new Date();

    const [row] = await db
      .update(endpointDeliveries)
      .set({
        status: 'pending',
        nextAttemptAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(endpointDeliveries.id, id),
          or(
            eq(endpointDeliveries.status, 'failed'),
            eq(endpointDeliveries.status, 'pending'),
          ),
        ),
      )
      .returning();

    return row ? toDelivery(row) : null;
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
        // On a final failure the column is left as it was. The plan asks for
        // NULL here (§15.6), but the column is NOT NULL and `status = 'failed'`
        // already says there is no next attempt — the due index is keyed on
        // status first, so nothing will ever read it.
        ...(nextAttemptAt ? { nextAttemptAt } : {}),
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
