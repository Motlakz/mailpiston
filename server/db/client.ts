import 'server-only';

import { neon } from '@neondatabase/serverless';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePool } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import { env } from '@/server/core/config';
import * as schema from './schema';

/**
 * Two clients, deliberately (roadmap §1.6).
 *
 * `db` is the WebSocket pool driver. It is the only one that can hold an
 * interactive transaction, so everything using `FOR UPDATE`, `SKIP LOCKED`, or
 * more than one statement per transaction must go through it — the rate
 * limiter and the delivery-claim path in particular.
 *
 * `dbRead` is the HTTP driver: one round trip per statement, no transactions,
 * lower latency for simple reads. Use it for dashboard and list queries.
 *
 * Using `dbRead` where a lock is required silently loses the lock, which is why
 * the two are named differently rather than being one configurable export.
 */
neonConfig.webSocketConstructor = ws;

declare global {
  // Reuse the pool across hot reloads in dev; a new Pool per reload leaks
  // sockets until the Neon connection limit is hit.
  var __mailpistonPool: Pool | undefined;
}

const pool =
  globalThis.__mailpistonPool ?? new Pool({ connectionString: env.DATABASE_URL });

if (env.NODE_ENV !== 'production') {
  globalThis.__mailpistonPool = pool;
}

/** Transaction-capable. Required for locking and multi-statement work. */
export const db = drizzlePool({ client: pool, schema });

/** Read-optimised, non-transactional. */
export const dbRead = drizzleHttp({
  client: neon(env.DATABASE_URL),
  schema,
});

export type Database = typeof db;
export type ReadDatabase = typeof dbRead;

/** Raw pool access, for the few places that need parameterised SQL directly. */
export { pool };
export { schema };
