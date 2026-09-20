import 'server-only';

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import { newId } from '@/server/core/ids';
import type { Paginated, Thread, ThreadListItem } from '@/server/core/types';
import { db } from '@/server/db/client';
import { emails, threads } from '@/server/db/schema';
import type { ThreadRepository } from '@/server/repositories/types';

type ThreadRow = typeof threads.$inferSelect;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class NeonThreadRepository implements ThreadRepository {
  async create(data: {
    subject: string | null;
    lastMessageAt: Date;
  }): Promise<Thread> {
    const [row] = await db
      .insert(threads)
      .values({ id: newId('thread'), ...data })
      .returning();

    return toThread(row);
  }

  async findById(id: string): Promise<Thread | null> {
    const [row] = await db
      .select()
      .from(threads)
      .where(eq(threads.id, id))
      .limit(1);

    return row ? toThread(row) : null;
  }

  /**
   * The thread owning any message with one of these ids.
   *
   * Both `message_id` and `provider_message_id` are matched, because the
   * `In-Reply-To` a customer's client sends back is whichever id their mail
   * client saw — which for a message we sent is the one the provider stamped.
   * That is the "known provider/message mapping" step of plan §12, and folding
   * it in here costs nothing over matching `message_id` alone.
   *
   * Most recent first: if a chain has somehow been split across two threads,
   * the newer one is the live conversation.
   */
  async findByMessageIds(messageIds: string[]): Promise<Thread | null> {
    const candidates = messageIds.filter(Boolean);
    if (candidates.length === 0) return null;

    const [row] = await db
      .select({ thread: threads })
      .from(emails)
      .innerJoin(threads, eq(emails.threadId, threads.id))
      .where(
        and(
          isNotNull(emails.threadId),
          or(
            inArray(emails.messageId, candidates),
            inArray(emails.providerMessageId, candidates),
          ),
        ),
      )
      .orderBy(desc(emails.createdAt))
      .limit(1);

    return row ? toThread(row.thread) : null;
  }

  /**
   * The conversation list.
   *
   * `minMessages` is what stops this page being a worse copy of `/mail`. Every
   * captured message creates a thread, so listing all of them lists every
   * message twice — once here and once there — and the duplicate is what makes
   * threads feel redundant. A conversation is a thread somebody replied in, and
   * `minMessages: 2` is that sentence as a query.
   *
   * Quarantined and binned messages do not count towards the total. A spam run
   * that happens to carry a `References` header must not manufacture a
   * conversation, and restoring a binned message should put its thread back
   * rather than having left a hollow one in the list.
   */
  async list(filter: {
    limit?: number;
    cursor?: string | null;
    minMessages?: number;
  }): Promise<Paginated<ThreadListItem>> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Threads page by activity, not creation: a long-running conversation that
    // just received a reply belongs at the top of the list.
    const cursorDate = filter.cursor ? new Date(filter.cursor) : null;
    const minMessages = filter.minMessages ?? 1;

    const counted = db
      .select({
        threadId: emails.threadId,
        messageCount: sql<number>`count(*)::int`.as('message_count'),
        participants: sql<
          string[]
        >`array_agg(distinct ${emails.from})`.as('participants'),
      })
      .from(emails)
      .where(and(isNotNull(emails.threadId), isNull(emails.deletedAt), eq(emails.spamVerdict, 'clean')))
      .groupBy(emails.threadId)
      .as('counted');

    const rows = await db
      .select({
        thread: threads,
        messageCount: counted.messageCount,
        participants: counted.participants,
      })
      .from(threads)
      .innerJoin(counted, eq(counted.threadId, threads.id))
      .where(
        and(
          cursorDate ? lt(threads.lastMessageAt, cursorDate) : undefined,
          gte(counted.messageCount, minMessages),
        ),
      )
      .orderBy(desc(threads.lastMessageAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      ...toThread(row.thread),
      messageCount: row.messageCount,
      participants: row.participants ?? [],
    }));

    return {
      items,
      nextCursor: hasMore
        ? (items.at(-1)?.lastMessageAt.toISOString() ?? null)
        : null,
    };
  }

  /**
   * Moves the activity timestamp forward, never backward.
   *
   * Mail arrives out of order — a message delayed in a queue can land after a
   * later reply — and letting an old message drag a thread down the list makes
   * the ordering unpredictable.
   */
  async touch(id: string, lastMessageAt: Date): Promise<void> {
    await db
      .update(threads)
      .set({
        lastMessageAt: sql`greatest(${threads.lastMessageAt}, ${lastMessageAt.toISOString()}::timestamptz)`,
        updatedAt: new Date(),
      })
      .where(eq(threads.id, id));
  }
}

function toThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    subject: row.subject,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
