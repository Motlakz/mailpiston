import 'server-only';

import { sql } from 'drizzle-orm';

import { dbRead } from '@/server/db/client';

import journal from './migrations/meta/_journal.json';

/**
 * How many migrations this build expects that the database has not applied.
 *
 * Deploying code and migrating a database are two separate acts and nothing
 * enforces their order, so a deployment can run ahead of its schema. When it
 * does, the failure is partial and confusing: a query that names a new column
 * throws while every query that does not carries on working. The page that
 * breaks is whichever one happens to `select *`, and in a production build the
 * message is stripped to a numbered React error.
 *
 * The journal ships in the bundle, so "what this build expects" needs no
 * database access; only the applied count is queried.
 *
 * Returns `null` when the migration table cannot be read at all — which is
 * itself the answer on a database that has never been migrated, and is
 * deliberately not reported as zero-pending.
 */
export async function pendingMigrationCount(): Promise<number | null> {
  const expected = journal.entries.length;

  try {
    const result = await dbRead.execute<{ applied: number }>(
      sql`select count(*)::int as applied from drizzle.__drizzle_migrations`,
    );

    const rows = (Array.isArray(result) ? result : result.rows) as Array<{
      applied: number;
    }>;

    const applied = Number(rows[0]?.applied ?? 0);
    if (!Number.isFinite(applied)) return null;

    // Never negative: a database ahead of this build is a rollback, which is a
    // real situation and not this function's business to report as pending.
    return Math.max(expected - applied, 0);
  } catch {
    return null;
  }
}
