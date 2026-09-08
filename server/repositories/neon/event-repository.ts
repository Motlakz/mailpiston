import 'server-only';

import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

import { newId } from '@/server/core/ids';
import { decodeTimeCursor, encodeTimeCursor } from '@/server/core/pagination';
import type { MailEvent, MailEventType, Paginated } from '@/server/core/types';
import { db } from '@/server/db/client';
import { emails, mailEvents } from '@/server/db/schema';
import type {
  EventFilter,
  EventRepository,
} from '@/server/repositories/types';

type EventRow = typeof mailEvents.$inferSelect;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class NeonEventRepository implements EventRepository {
  async create(data: {
    emailId: string | null;
    type: MailEventType;
    metadata: Record<string, unknown>;
  }): Promise<MailEvent> {
    const [row] = await db
      .insert(mailEvents)
      .values({ id: newId('event'), ...data })
      .returning();

    return toEvent(row);
  }

  async findById(id: string): Promise<MailEvent | null> {
    const [row] = await db
      .select()
      .from(mailEvents)
      .where(eq(mailEvents.id, id))
      .limit(1);

    return row ? toEvent(row) : null;
  }

  async list(filter: EventFilter): Promise<Paginated<MailEvent>> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const cursor = decodeTimeCursor(filter.cursor);

    // Joined only when the filter needs it. An address filter has to reach
    // through the message, because events carry no address of their own.
    const base = filter.addressId
      ? db
          .select({ event: mailEvents })
          .from(mailEvents)
          .leftJoin(emails, eq(mailEvents.emailId, emails.id))
      : db.select({ event: mailEvents }).from(mailEvents);

    const rows = await base
      .where(
        and(
          filter.emailId ? eq(mailEvents.emailId, filter.emailId) : undefined,
          filter.types?.length ? inArray(mailEvents.type, filter.types) : undefined,
          addressCondition(filter),
          filter.endpointId
            ? sql`${mailEvents.metadata}->>'endpointId' = ${filter.endpointId}`
            : undefined,
          filter.since ? gte(mailEvents.occurredAt, filter.since) : undefined,
          filter.until ? lte(mailEvents.occurredAt, filter.until) : undefined,
          // Composite keyset. Several events for one message are written inside
          // a single transaction and routinely share a millisecond, so a cursor
          // on the timestamp alone would drop whichever of them landed on a page
          // boundary. The id is an arbitrary but stable tiebreak.
          cursor
            ? sql`(${mailEvents.occurredAt}, ${mailEvents.id}) < (${cursor.occurredAt.toISOString()}::timestamptz, ${cursor.id})`
            : undefined,
        ),
      )
      .orderBy(desc(mailEvents.occurredAt), desc(mailEvents.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) =>
      toEvent(row.event),
    );

    const last = items.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? encodeTimeCursor(last) : null,
    };
  }
}

/**
 * Everything for one mailbox, including the mail we refused on its behalf.
 *
 * A rejection has no message and therefore no address — only a recipient in its
 * metadata. Leaving it out would mean the one filter an operator reaches for
 * when mail goes missing is the one that hides the answer.
 */
function addressCondition(filter: EventFilter) {
  if (!filter.addressId) return undefined;

  const owned = eq(emails.addressId, filter.addressId);

  if (!filter.recipient) return owned;

  return or(
    owned,
    sql`lower(${mailEvents.metadata}->>'recipient') = ${filter.recipient.toLowerCase()}`,
  );
}

function toEvent(row: EventRow): MailEvent {
  return {
    id: row.id,
    emailId: row.emailId,
    type: row.type,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    occurredAt: row.occurredAt,
  };
}
