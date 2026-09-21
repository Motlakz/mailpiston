import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { tenantRole } from './enums';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Tenancy (roadmap §5.4, superseding the single-operator model).
 *
 * A tenant is one customer's workspace: their domains, addresses, threads and
 * keys, and — the part that makes this shape work — *their own* mail provider
 * account. MailPiston hosts the control plane; it does not front anybody's
 * provider.
 *
 * That is a deliberate rejection of pooling. One shared provider account would
 * mean one shared send quota, one shared sending reputation that any tenant
 * could damage for the rest, and an operator who technically holds every
 * customer's mail under a single key. Bring-your-own-credentials removes all
 * three, at the cost of a signup step.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** URL-safe handle. Lower-cased at the boundary, unique across the install. */
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('tenants_slug_key').on(table.slug)],
);

/**
 * Who may act as a tenant.
 *
 * This replaces `ALLOWED_OPERATOR_EMAILS` as the authorisation model. The
 * allow-list answered "is this person the operator"; membership answers "which
 * workspace is this person in", which is the question a hosted product has to
 * ask on every request.
 *
 * A user may belong to more than one tenant — an agency running mail for two
 * of its own products is the ordinary case, not an edge one.
 */
export const tenantMembers = pgTable(
  'tenant_members',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: tenantRole('role').notNull().default('owner'),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.userId] })],
);

/**
 * A tenant's provider credentials, encrypted at rest.
 *
 * Encrypted rather than hashed because the server must *use* the token to call
 * the provider — the same trade already made for endpoint signing secrets, and
 * the same key (`SECRET_ENCRYPTION_KEY`) covers both.
 *
 * One row per tenant per provider. The provider id is stored rather than
 * assumed so a tenant on the mock provider in development, and a future second
 * adapter, both fit without a schema change.
 */
export const tenantProviderCredentials = pgTable(
  'tenant_provider_credentials',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Matches `ProviderId` in the registry. */
    provider: text('provider').notNull(),
    /** AES-GCM ciphertext. Never returned to a client, never logged. */
    apiTokenCiphertext: text('api_token_ciphertext').notNull(),
    /**
     * Set when the token was last confirmed to work against the provider.
     * Null means it has never been validated, which onboarding surfaces rather
     * than discovering on the first inbound message.
     */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.provider] })],
);
