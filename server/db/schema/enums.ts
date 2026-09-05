import { pgEnum } from 'drizzle-orm/pg-core';

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
export const mailEventType = pgEnum('mail_event_type', [
  'email.received',
  'email.rejected',
  'email.queued',
  'email.sent',
  'email.delivered',
  'email.forwarded',
  'email.soft_bounced',
  'email.hard_bounced',
  'email.failed',
  'personal_forward.queued',
  'personal_forward.delivered',
  'personal_forward.failed',
  'relay.reply_received',
  'relay.reply_rejected',
  'relay.reply_sent',
  'webhook.queued',
  'webhook.delivered',
  'webhook.failed',
]);

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
