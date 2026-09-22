import { pgEnum } from 'drizzle-orm/pg-core';

import { MAIL_EVENT_TYPES, type MailEventType } from '@/server/core/types';

/** Execution plan §4.1 */
export const domainStatus = pgEnum('domain_status', [
  'pending',
  'verified',
  'failed',
  'disabled',
]);

/** Execution plan §4.3 */
export const endpointType = pgEnum('endpoint_type', [
  'webhook',
  'email',
  'email_group',
]);

/** Execution plan §4.6 */
export const emailDirection = pgEnum('email_direction', ['inbound', 'outbound']);

export const emailStatus = pgEnum('email_status', [
  'received',
  'queued',
  'sent',
  'delivered',
  'soft_bounced',
  'hard_bounced',
  'failed',
]);

/**
 * Inbound abuse classification (roadmap Phase 12).
 *
 * Three states, not two, because the middle one is what keeps the filter
 * trustworthy. `spam` is hidden and not fanned out; `suspicious` is delivered
 * normally and merely marked, which is where everything the engine is unsure
 * about lands. Collapsing the two would force every borderline message to be
 * either invisible or unremarkable, and the borderline cases are exactly the
 * ones an operator wants to look at.
 */
export const spamVerdict = pgEnum('spam_verdict', [
  'clean',
  'suspicious',
  'spam',
]);

/** Whether an operator list entry vouches for a sender or blocks one. */
export const mailFilterKind = pgEnum('mail_filter_kind', ['allow', 'deny']);

/**
 * Execution plan §4.7, plus `email.rejected` — required by the catch-all
 * decision (roadmap §1.2): mail for an unknown local part is recorded and
 * dropped rather than bounced.
 */
export const mailEventType = pgEnum('mail_event_type', MAIL_EVENT_TYPES);

/**
 * The Postgres enum and the domain type are the same list, and this makes the
 * compiler enforce it. Adding a type without a migration would otherwise fail
 * only at runtime, on the insert of the first event of the new kind.
 */
type MailEventTypesMatch =
  (typeof mailEventType.enumValues)[number] extends MailEventType
    ? MailEventType extends (typeof mailEventType.enumValues)[number]
      ? true
      : never
    : never;

const _mailEventTypesMatch: MailEventTypesMatch = true;
void _mailEventTypesMatch;

/** Execution plan §4.8 */
export const deliveryStatus = pgEnum('delivery_status', [
  'pending',
  'delivering',
  'delivered',
  'failed',
]);

export const reconciliationRunStatus = pgEnum('reconciliation_run_status', [
  'running',
  'completed',
  'failed',
]);

export const reconciliationItemStatus = pgEnum('reconciliation_item_status', [
  'ok',
  'drift',
  'missing',
  'error',
]);

/**
 * What a member may do inside a tenant.
 *
 * `owner` is the only role the product enforces today — it exists as an enum
 * rather than a boolean so adding `member` later is a migration of one value,
 * not a column swap across every membership row.
 */
export const tenantRole = pgEnum('tenant_role', ['owner', 'member']);
