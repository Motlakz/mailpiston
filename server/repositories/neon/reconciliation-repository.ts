import 'server-only';

import { asc, desc, eq } from 'drizzle-orm';

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
  async startRun(provider: string): Promise<ReconciliationRun> {
    const [row] = await db
      .insert(providerReconciliationRuns)
      .values({ id: newId('run'), provider })
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
      .where(eq(providerReconciliationRuns.id, id))
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
      .orderBy(desc(providerReconciliationRuns.startedAt))
      .limit(1);

    return row ? toRun(row) : null;
  }

  async listRuns(limit = DEFAULT_RUN_LIMIT): Promise<ReconciliationRun[]> {
    const rows = await db
      .select()
      .from(providerReconciliationRuns)
      .orderBy(desc(providerReconciliationRuns.startedAt))
      .limit(limit);

    return rows.map(toRun);
  }

  /** Ascending: a run reads as the order things were checked in. */
  async listItems(runId: string): Promise<ReconciliationItem[]> {
    const rows = await db
      .select()
      .from(providerReconciliationItems)
      .where(eq(providerReconciliationItems.runId, runId))
      .orderBy(asc(providerReconciliationItems.createdAt));

    return rows.map(toItem);
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
