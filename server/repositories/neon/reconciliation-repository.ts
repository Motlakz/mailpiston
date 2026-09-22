import 'server-only';

import { and, asc, desc, eq } from 'drizzle-orm';

import { NotFoundError } from '@/server/core/errors';
import { newId } from '@/server/core/ids';
import type {
  ReconciliationItem,
  ReconciliationItemStatus,
  ReconciliationRun,
} from '@/server/core/types';
import { db } from '@/server/db/client';
import {
  providerReconciliationItems,
  providerReconciliationRuns,
} from '@/server/db/schema';
import type { ReconciliationRepository } from '@/server/repositories/types';

type RunRow = typeof providerReconciliationRuns.$inferSelect;
type ItemRow = typeof providerReconciliationItems.$inferSelect;

const DEFAULT_RUN_LIMIT = 20;

export class NeonReconciliationRepository implements ReconciliationRepository {
  constructor(private readonly tenantId: string) {}

  async startRun(provider: string): Promise<ReconciliationRun> {
    const [row] = await db
      .insert(providerReconciliationRuns)
      .values({ id: newId('run'), tenantId: this.tenantId, provider })
      .returning();

    return toRun(row);
  }

  async finishRun(
    id: string,
    status: 'completed' | 'failed',
    error: string | null = null,
  ): Promise<ReconciliationRun> {
    const [row] = await db
      .update(providerReconciliationRuns)
      .set({ status, error, finishedAt: new Date() })
      .where(
        and(
          eq(providerReconciliationRuns.tenantId, this.tenantId),
          eq(providerReconciliationRuns.id, id),
        ),
      )
      .returning();

    if (!row) throw new NotFoundError(`Reconciliation run ${id} not found`);
    return toRun(row);
  }

  async addItem(data: {
    runId: string;
    resourceType: string;
    resourceId: string;
    status: ReconciliationItemStatus;
    detail: Record<string, unknown>;
  }): Promise<ReconciliationItem> {
    const [row] = await db
      .insert(providerReconciliationItems)
      .values({ id: newId('item'), ...data })
      .returning();

    return toItem(row);
  }

  async latestRun(): Promise<ReconciliationRun | null> {
    const [row] = await db
      .select()
      .from(providerReconciliationRuns)
      .where(eq(providerReconciliationRuns.tenantId, this.tenantId))
      .orderBy(desc(providerReconciliationRuns.startedAt))
      .limit(1);

    return row ? toRun(row) : null;
  }

  async listRuns(limit = DEFAULT_RUN_LIMIT): Promise<ReconciliationRun[]> {
    const rows = await db
      .select()
      .from(providerReconciliationRuns)
      .where(eq(providerReconciliationRuns.tenantId, this.tenantId))
      .orderBy(desc(providerReconciliationRuns.startedAt))
      .limit(limit);

    return rows.map(toRun);
  }

  /**
   * Ascending: a run reads as the order things were checked in.
   *
   * Items carry no tenant column — they hang off a run, and the join below
   * proves that run belongs to this tenant before a single item is returned.
   */
  async listItems(runId: string): Promise<ReconciliationItem[]> {
    const rows = await db
      .select({ item: providerReconciliationItems })
      .from(providerReconciliationItems)
      .innerJoin(
        providerReconciliationRuns,
        eq(providerReconciliationItems.runId, providerReconciliationRuns.id),
      )
      .where(
        and(
          eq(providerReconciliationRuns.tenantId, this.tenantId),
          eq(providerReconciliationItems.runId, runId),
        ),
      )
      .orderBy(asc(providerReconciliationItems.createdAt));

    return rows.map((row) => toItem(row.item));
  }
}

function toRun(row: RunRow): ReconciliationRun {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
  };
}

function toItem(row: ItemRow): ReconciliationItem {
  return {
    id: row.id,
    runId: row.runId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    status: row.status,
    detail: (row.detail ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}
