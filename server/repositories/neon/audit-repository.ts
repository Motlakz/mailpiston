import 'server-only';

import { and, desc, eq, lt } from 'drizzle-orm';

import { newId } from '@/server/core/ids';
import type { AuditEntry, Paginated } from '@/server/core/types';
import { db } from '@/server/db/client';
import { auditLogs } from '@/server/db/schema';
import type { AuditRepository } from '@/server/repositories/types';

type AuditRow = typeof auditLogs.$inferSelect;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class NeonAuditRepository implements AuditRepository {
  async record(data: {
    actor: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    metadata: Record<string, unknown>;
  }): Promise<AuditEntry> {
    const [row] = await db
      .insert(auditLogs)
      .values({ id: newId('audit'), ...data })
      .returning();

    return toEntry(row);
  }

  async list(filter: {
    action?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<Paginated<AuditEntry>> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const cursorDate = filter.cursor ? new Date(filter.cursor) : null;

    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          filter.action ? eq(auditLogs.action, filter.action) : undefined,
          cursorDate && !Number.isNaN(cursorDate.getTime())
            ? lt(auditLogs.occurredAt, cursorDate)
            : undefined,
        ),
      )
      .orderBy(desc(auditLogs.occurredAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toEntry);

    return {
      items,
      nextCursor: hasMore
        ? (items.at(-1)?.occurredAt.toISOString() ?? null)
        : null,
    };
  }
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    occurredAt: row.occurredAt,
  };
}
