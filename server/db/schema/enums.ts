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
