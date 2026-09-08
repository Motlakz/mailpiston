import 'server-only';

import { and, desc, eq, lt } from 'drizzle-orm';

import { newId } from '@/server/core/ids';
import type { MailEvent, MailEventType, Paginated } from '@/server/core/types';
import { db } from '@/server/db/client';
import { mailEvents } from '@/server/db/schema';
import type { EventRepository } from '@/server/repositories/types';

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

  async list(filter: {
    emailId?: string;
    type?: MailEventType;
    limit?: number;
    cursor?: string | null;
  }): Promise<Paginated<MailEvent>> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Cursor is the ISO timestamp of the last row seen. Events are append-only
    // and ordered by occurrence, so an offset would skip rows written mid-page.
    const cursorDate = filter.cursor ? new Date(filter.cursor) : null;

    const rows = await db
      .select()
      .from(mailEvents)
      .where(
        and(
          filter.emailId ? eq(mailEvents.emailId, filter.emailId) : undefined,
          filter.type ? eq(mailEvents.type, filter.type) : undefined,
          cursorDate ? lt(mailEvents.occurredAt, cursorDate) : undefined,
        ),
      )
      .orderBy(desc(mailEvents.occurredAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toEvent);

    return {
      items,
      nextCursor: hasMore
        ? (items.at(-1)?.occurredAt.toISOString() ?? null)
        : null,
    };
  }
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
