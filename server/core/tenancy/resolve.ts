import 'server-only';

import { and, eq, inArray, or, sql } from 'drizzle-orm';

import { isRelayRecipient, relayLocalToken } from '@/server/core/config';
import { sha256Hex } from '@/server/core/crypto';
import { db } from '@/server/db/client';
import {
  addresses,
  apiKeys,
  domains,
  emails,
  replyRelays,
  tenantMembers,
  tenants,
} from '@/server/db/schema';

/**
 * The one place that reads across tenants, on purpose.
 *
 * Everything else in the data layer is bound to a tenant at construction, which
 * is what makes a cross-tenant read impossible rather than unlikely. That
 * guarantee needs an entry point: something has to answer *which* tenant a
 * request belongs to before a scoped repository can exist, and that question
 * cannot itself be asked inside a scope.
 *
 * So the unscoped queries live here, they are few, and each one returns a
 * tenant id and nothing else — never a row, never a payload. A caller cannot
 * accidentally render or act on data this module touched, because it does not
 * hand any back.
 *
 * Every function is a lookup on a unique, unguessable or externally-owned key:
 * a session's membership, an API key hash, a verified domain name, a relay
 * token hash. None of them takes a caller-supplied id that could be enumerated.
 */

/** The tenant a signed-in user belongs to, or null. */
export async function tenantForUser(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, userId))
    .limit(1);

  return row?.tenantId ?? null;
}

/** The tenant an API key belongs to, looked up by hash. */
export async function tenantForApiKeyHash(
  keyHash: string,
): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: apiKeys.tenantId })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  return row?.tenantId ?? null;
}

/**
 * The tenant that owns a domain.
 *
 * This is the inbound path: a provider delivers a message for
 * `support@example.com` and nothing in the request says whose workspace that
 * is. The domain name is the only handle, and it is unique per install.
 */
export async function tenantForDomain(name: string): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: domains.tenantId })
    .from(domains)
    .where(eq(sql`lower(${domains.name})`, name.toLowerCase()))
    .limit(1);

  return row?.tenantId ?? null;
}

/**
 * The tenant that owns a managed address, by its full email.
 *
 * An address stores a local part and a domain id rather than a whole address,
 * so this joins rather than comparing one column — the same split the inbound
 * router works with.
 */
export async function tenantForAddress(email: string): Promise<string | null> {
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;

  const [row] = await db
    .select({ tenantId: addresses.tenantId })
    .from(addresses)
    .innerJoin(domains, eq(addresses.domainId, domains.id))
    .where(
      and(
        sql`lower(${addresses.localPart}) = ${email.slice(0, at).toLowerCase()}`,
        sql`lower(${domains.name}) = ${email.slice(at + 1).toLowerCase()}`,
      ),
    )
    .limit(1);

  return row?.tenantId ?? null;
}

/**
 * The tenant behind a reply-relay token.
 *
 * A relay address is the one inbound recipient that names no domain of ours —
 * `reply+<token>@<relay-domain>` is platform infrastructure shared by every
 * tenant, and the token is the only thing that says whose thread it answers.
 * Looking it up therefore cannot be scoped: the lookup *is* the scoping.
 *
 * Revoked and expired tokens resolve to null here rather than being filtered
 * later, so an expired relay never reaches a tenant's data at all.
 */
export async function tenantForRelayTokenHash(
  tokenHash: string,
): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: replyRelays.tenantId, expiresAt: replyRelays.expiresAt })
    .from(replyRelays)
    .where(
      and(
        eq(replyRelays.tokenHash, tokenHash),
        sql`${replyRelays.revokedAt} is null`,
      ),
    )
    .limit(1);

  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  return row.tenantId;
}

/**
 * Every tenant id, for the scheduled jobs.
 *
 * Reconciliation and retention are sweeps, not requests — they belong to no
 * one, so they run once per tenant against that tenant's own scoped services
 * and provider account. Returning ids rather than rows keeps the rule above
 * intact: this module hands back tenant identifiers and never data.
 */
export async function allTenantIds(): Promise<string[]> {
  const rows = await db.select({ id: tenants.id }).from(tenants);
  return rows.map((row) => row.id);
}

/**
 * The tenant an inbound message belongs to.
 *
 * This is the hard case, and the reason this module exists. A provider POSTs a
 * message and the request carries no session, no API key and no workspace —
 * only a recipient. Two shapes answer it:
 *
 *  - a **relay address**, `reply+<token>@<relay domain>`, which belongs to no
 *    tenant's domain at all. The relay domain is platform infrastructure
 *    shared by everyone, so the opaque token is the only thing that says whose
 *    thread is being answered.
 *  - an **ordinary recipient** on a domain some tenant has verified.
 *
 * Null means nobody owns it. The caller must treat that as a rejection and
 * still answer 200 — bouncing a catch-all is backscatter.
 */
export async function tenantForInboundRecipient(
  recipient: string,
): Promise<string | null> {
  if (isRelayRecipient(recipient)) {
    const token = relayLocalToken(recipient);
    return token ? tenantForRelayTokenHash(sha256Hex(token)) : null;
  }

  const at = recipient.lastIndexOf('@');
  if (at <= 0) return null;

  return tenantForDomain(recipient.slice(at + 1));
}

/**
 * The tenant that sent a message, by whichever id the provider knows it as.
 *
 * A delivery event names a message, not a workspace — and the two ids are not
 * interchangeable: `providerMessageId` is what the provider stamped and is
 * what it is sure of, `messageId` is the RFC id we generated. Both are matched
 * because a provider may report either.
 *
 * Null means the event is about mail this deployment never sent, which is a
 * normal thing to receive on a shared provider account.
 */
export async function tenantForProviderMessage(
  providerMessageId: string | null,
  messageId: string | null,
): Promise<string | null> {
  const candidates = [providerMessageId, messageId].filter(
    (value): value is string => Boolean(value),
  );
  if (candidates.length === 0) return null;

  const [row] = await db
    .select({ tenantId: emails.tenantId })
    .from(emails)
    .where(
      or(
        inArray(emails.providerMessageId, candidates),
        inArray(emails.messageId, candidates),
      ),
    )
    .limit(1);

  return row?.tenantId ?? null;
}
