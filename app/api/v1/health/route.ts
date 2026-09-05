import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { dbRead } from '@/server/db/client';

/**
 * Liveness plus a real database round trip.
 *
 * Unauthenticated on purpose — a health check that needs a credential cannot
 * tell you the deployment is broken when the credential is what broke. It
 * reports no version, no configuration, and no error detail.
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

  return NextResponse.json({
    status: 'ok',
    database: 'ok',
    latencyMs: Date.now() - startedAt,
  });
}
