import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  deliveryStatus,
  domainStatus,
  emailDirection,
  emailStatus,
  endpointType,
  mailEventType,
} from './enums';

const id = () => text('id').primaryKey();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** §4.1 */
export const domains = pgTable(
  'domains',
  {
    id: id(),
    name: text('name').notNull(),
    providerDomainId: text('provider_domain_id'),
    status: domainStatus('status').notNull().default('pending'),
    /**
     * A catch-all alias is optional domain configuration (roadmap §1.2), not a
     * prerequisite for a managed mailbox. Null means no catch-all exists.
     */
    catchAllAliasId: text('catch_all_alias_id'),
    /** DNS records the provider requires, cached for the dashboard table. */
    dnsRecords: jsonb('dns_records').notNull().default(sql`'[]'::jsonb`),
    /**
     * What the provider said was missing at the last check. A domain whose
     * records have not propagated is a normal onboarding state, so the reasons
     * are cached for the dashboard rather than surfaced as a failed request.
     */
    verificationErrors: jsonb('verification_errors')
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('domains_name_key').on(sql`lower(${table.name})`)],
);

/** §4.2 */
export const addresses = pgTable(
  'addresses',
  {
    id: id(),
    domainId: text('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    localPart: text('local_part').notNull(),
    /**
     * Null: an inbound-only local route living behind the domain catch-all.
     * Non-null: a concrete provider alias, which is what authorises sending
     * as this address (roadmap §5.6).
     */
    providerAliasId: text('provider_alias_id'),
    canSend: boolean('can_send').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Local parts are case-insensitive, so uniqueness must be too.
    uniqueIndex('addresses_domain_local_part_key').on(
      table.domainId,
      sql`lower(${table.localPart})`,
    ),
  ],
);

/**
 * The per-domain key Forward Email signs inbound webhook bodies with.
 *
 * A sibling table rather than a column on `domains`, for the same reason
 * `endpoint_webhook_configs` is a sibling of `endpoints`: the domain row is
 * read on ordinary paths that have no business carrying a secret, and keeping
 * the ciphertext out of it means an accidental `select *` cannot leak one.
 *
 * Encrypted, not hashed. The server has to recover the plaintext to recompute
 * an HMAC — a hash would make the key unusable for the one thing it is for.
 */
export const domainWebhookKeys = pgTable('domain_webhook_keys', {
  domainId: text('domain_id')
    .primaryKey()
    .references(() => domains.id, { onDelete: 'cascade' }),
  keyCiphertext: text('key_ciphertext').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** §4.3 */
export const endpoints = pgTable('endpoints', {
  id: id(),
  name: text('name').notNull(),
  type: endpointType('type').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const endpointWebhookConfigs = pgTable('endpoint_webhook_configs', {
  endpointId: text('endpoint_id')
    .primaryKey()
    .references(() => endpoints.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  /**
   * Encrypted, not hashed: the server must recover this secret to sign every
   * outbound delivery (§4.3).
   */
  secretCiphertext: text('secret_ciphertext').notNull(),
});

export const endpointEmailRecipients = pgTable(
  'endpoint_email_recipients',
  {
    id: id(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /**
     * Proof of control, not authentication: the operator can type any address
     * here, and mail must not start flowing to a stranger because of a typo.
     * Hashed like every other token we issue — a leaked table must not let
     * anyone complete a verification.
     */
    verificationTokenHash: text('verification_token_hash'),
    verificationExpiresAt: timestamp('verification_expires_at', {
      withTimezone: true,
    }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('endpoint_email_recipients_key').on(
      table.endpointId,
      sql`lower(${table.email})`,
    ),
  ],
);

/** §4.4 — many-to-many, no extra columns. */
export const addressEndpoints = pgTable(
  'address_endpoints',
  {
    addressId: text('address_id')
      .notNull()
      .references(() => addresses.id, { onDelete: 'cascade' }),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.addressId, table.endpointId] })],
);

/** §4.4A — the public relay address carries an opaque token and nothing else. */
export const replyRelays = pgTable(
  'reply_relays',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    addressId: text('address_id')
      .notNull()
      .references(() => addresses.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull(),
    endpointEmailRecipientId: text('endpoint_email_recipient_id')
      .notNull()
      .references(() => endpointEmailRecipients.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('reply_relays_token_hash_key').on(table.tokenHash)],
);

/** §4.5 */
export const threads = pgTable('threads', {
  id: id(),
  subject: text('subject'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** §4.6 */
export const emails = pgTable(
  'emails',
  {
    id: id(),
    threadId: text('thread_id').references(() => threads.id, {
      onDelete: 'set null',
    }),
    addressId: text('address_id').references(() => addresses.id, {
      onDelete: 'set null',
    }),

    providerMessageId: text('provider_message_id'),
    messageId: text('message_id'),

    /**
     * Inbound idempotency (§10.1), carried on the row it protects rather than
     * in a separate `idempotency_keys` claim.
     *
     * A claim taken before the insert leaves a window: if the process dies
     * between claiming and writing, the provider's retry sees the key taken
     * and the message is lost forever. A unique index on the row itself has no
     * such window — the insert either happens or it does not, and a retry hits
     * a constraint violation that means exactly "already stored".
     *
     * Null for outbound, which has no inbound delivery to deduplicate.
     * Postgres allows unlimited NULLs in a unique index, so that is free.
     */
    fingerprint: text('fingerprint'),

    direction: emailDirection('direction').notNull(),
    status: emailStatus('status').notNull(),

    from: text('from').notNull(),
    to: text('to')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    cc: text('cc')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    subject: text('subject'),
    text: text('text'),
    html: text('html'),

    inReplyTo: text('in_reply_to'),
    references: text('references')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    /** R2 key for the original MIME source, when STORE_RAW_MIME is on. */
    rawStorageKey: text('raw_storage_key'),

    receivedAt: timestamp('received_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('emails_thread_id_idx').on(table.threadId),
    index('emails_address_id_idx').on(table.addressId),
    index('emails_message_id_idx').on(table.messageId),
    index('emails_created_at_idx').on(table.createdAt),
    uniqueIndex('emails_fingerprint_key').on(table.fingerprint),
  ],
);

/** §18 — metadata here, bytes in R2. */
export const emailAttachments = pgTable(
  'email_attachments',
  {
    id: id(),
    emailId: text('email_id')
      .notNull()
      .references(() => emails.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    /**
     * When retention removed the bytes (Phase 11).
     *
     * The row survives its content on purpose: "this message had a 4 MB PDF
     * called invoice.pdf, and we deleted it on the 3rd" is a complete answer,
     * and deleting the row instead would leave the operator looking at a
     * message that appears never to have had an attachment at all.
     */
    prunedAt: timestamp('pruned_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('email_attachments_email_id_idx').on(table.emailId),
    // The retention sweep scans oldest-first for rows not yet pruned.
    index('email_attachments_pruned_at_idx').on(table.prunedAt, table.createdAt),
  ],
);

/** §4.7 */
export const mailEvents = pgTable(
  'mail_events',
  {
    id: id(),
    emailId: text('email_id').references(() => emails.id, {
      onDelete: 'cascade',
    }),
    type: mailEventType('type').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mail_events_email_id_idx').on(table.emailId),
    index('mail_events_occurred_at_idx').on(table.occurredAt),
  ],
);

/** §4.8 */
export const endpointDeliveries = pgTable(
  'endpoint_deliveries',
  {
    id: id(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => mailEvents.id, { onDelete: 'cascade' }),
    recipientId: text('recipient_id').references(
      () => endpointEmailRecipients.id,
      { onDelete: 'set null' },
    ),

    status: deliveryStatus('status').notNull().default('pending'),

    attempt: integer('attempt').notNull().default(0),
    responseCode: integer('response_code'),
    lastError: text('last_error'),

    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The Phase 8 claim query scans this: due work, oldest first.
    index('endpoint_deliveries_due_idx').on(table.status, table.nextAttemptAt),
    // One delivery row per (event, endpoint, recipient) so a re-enqueue after a
    // crash cannot double-deliver.
    uniqueIndex('endpoint_deliveries_event_target_key').on(
      table.eventId,
      table.endpointId,
      sql`coalesce(${table.recipientId}, '')`,
    ),
  ],
);
