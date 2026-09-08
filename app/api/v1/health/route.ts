import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { dbRead } from '@/server/db/client';
import { pendingMigrationCount } from '@/server/db/migration-state';

/**
 * Liveness, a real database round trip, and whether the schema matches the code.
 *
 * Unauthenticated on purpose — a health check that needs a credential cannot
 * tell you the deployment is broken when the credential is what broke. It
 * reports no version, no configuration, and no error detail; `schema` is a
 * one-word verdict for the same reason.
 *
 * The schema check exists because deploying code and migrating a database are
 * two separate acts, and nothing enforces their order. A deployment running
 * ahead of its database half-works — queries that name a new column fail while
 * everything else carries on — so the symptom is one broken page and a stack
 * trace stripped by the production build. That is worth one query per health
 * check to make legible.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await dbRead.execute(sql`SELECT 1`);
  } catch (error) {
    console.error('Health check failed to reach the database', error);

    return NextResponse.json(
      { status: 'degraded', database: 'unreachable' },
      { status: 503 },
    );
  }

  const pending = await pendingMigrationCount();

  if (pending === null) {
    // We reached the database but could not read its migration state. Say so
    // rather than reporting `ok`: "we could not tell" is not "fine".
    return NextResponse.json({
      status: 'ok',
      database: 'ok',
      schema: 'unknown',
      latencyMs: Date.now() - startedAt,
    });
  }

  if (pending > 0) {
    return NextResponse.json(
      {
        status: 'degraded',
        database: 'ok',
        schema: 'behind',
        latencyMs: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    status: 'ok',
    database: 'ok',
    schema: 'ok',
    latencyMs: Date.now() - startedAt,
  });
}
