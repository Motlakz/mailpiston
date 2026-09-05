import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { reconciliationItemStatus, reconciliationRunStatus } from './enums';

/**
 * §24 — API keys are stored hashed. The plaintext is shown exactly once, at
 * creation, and is never recoverable afterwards.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** SHA-256 of the full plaintext key. Looked up directly, so it is unique. */
    keyHash: text('key_hash').notNull(),
    /** e.g. `mp_live_a1b2…`, enough to identify a key in the UI. */
    keyPrefix: text('key_prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('api_keys_key_hash_key').on(table.keyHash)],
);

/**
 * §9.1 — fixed-window counters, one row per (actor, endpoint).
 *
 * Mutated only through the transactional `SELECT … FOR UPDATE` path in
 * `server/core/rate-limit`; never read-then-write.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    actorKey: text('actor_key').notNull(),
    endpoint: text('endpoint').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    requestCount: integer('request_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.actorKey, table.endpoint] })],
);

/** §10.1 — claimed by an `INSERT … ON CONFLICT DO NOTHING RETURNING key`. */
export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Phase 10 — drift detection against the provider. Never auto-repairs. */
export const providerReconciliationRuns = pgTable(
  'provider_reconciliation_runs',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    status: reconciliationRunStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
  },
  (table) => [index('provider_reconciliation_runs_started_at_idx').on(table.startedAt)],
);

export const providerReconciliationItems = pgTable(
  'provider_reconciliation_items',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => providerReconciliationRuns.id, { onDelete: 'cascade' }),
    /** `domain` | `alias` — what was compared. */
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    status: reconciliationItemStatus('status').notNull(),
    detail: jsonb('detail').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('provider_reconciliation_items_run_id_idx').on(table.runId)],
);

/** §24 — audit log for privileged mutations. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('audit_logs_occurred_at_idx').on(table.occurredAt)],
);
