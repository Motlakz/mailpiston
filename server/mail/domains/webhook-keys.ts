import 'server-only';

import { eq } from 'drizzle-orm';

import { env } from '@/server/core/config';
import { decryptSecret, encryptSecret } from '@/server/core/crypto';
import { db } from '@/server/db/client';
import { domainWebhookKeys, domains } from '@/server/db/schema';

/**
 * Per-domain inbound webhook keys.
 *
 * Forward Email issues one webhook key per domain, so a deployment serving
 * several domains holds several keys and the single `FORWARD_EMAIL_WEBHOOK_KEY`
 * environment variable cannot verify all of them.
 *
 * That variable is kept as a fallback rather than removed. A single-domain
 * setup — which is every setup on its first day — keeps working untouched, and
 * an operator who has not yet stored a key per domain is not locked out of
 * their own ingress by an upgrade.
 */
const CACHE_TTL_MS = 60_000;

let cache: { keys: readonly string[]; expiresAt: number } | null = null;

/**
 * Every key an inbound request may have been signed with.
 *
 * Cached for a minute because this runs *before* authentication: without a
 * cache, an unauthenticated caller could drive one database query per request
 * simply by POSTing garbage at the ingress. A minute is short enough that a
 * rotated key takes effect on its own, and `invalidateWebhookKeyCache` makes it
 * immediate for the operator who just changed it.
 */
export async function resolveInboundWebhookKeys(): Promise<readonly string[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.keys;

  const rows = await db
    .select({ keyCiphertext: domainWebhookKeys.keyCiphertext })
    .from(domainWebhookKeys);

  const stored = rows.flatMap((row) => {
    try {
      return [decryptSecret(row.keyCiphertext)];
    } catch (error) {
      // A key that will not decrypt means SECRET_ENCRYPTION_KEY changed under
      // it. Skip it loudly rather than throwing: one unreadable key must not
      // take down ingress for every other domain.
      console.error('[webhook-keys] stored key failed to decrypt', error);
      return [];
    }
  });

  const fallback = env.FORWARD_EMAIL_WEBHOOK_KEY;
  const keys = Array.from(
    new Set(fallback ? [...stored, fallback] : stored),
  );

  cache = { keys, expiresAt: now + CACHE_TTL_MS };
  return keys;
}

export function invalidateWebhookKeyCache(): void {
  cache = null;
}

/** Stores (or replaces) the webhook key for one domain. */
export async function setDomainWebhookKey(
  domainId: string,
  webhookKey: string,
): Promise<void> {
  const keyCiphertext = encryptSecret(webhookKey);

  await db
    .insert(domainWebhookKeys)
    .values({ domainId, keyCiphertext })
    .onConflictDoUpdate({
      target: domainWebhookKeys.domainId,
      set: { keyCiphertext, updatedAt: new Date() },
    });

  invalidateWebhookKeyCache();
}

export async function deleteDomainWebhookKey(domainId: string): Promise<void> {
  await db
    .delete(domainWebhookKeys)
    .where(eq(domainWebhookKeys.domainId, domainId));

  invalidateWebhookKeyCache();
}

/**
 * Which domains have a key stored — never the keys themselves.
 *
 * The dashboard needs to show "configured" or "not configured" beside each
 * domain, and nothing in the UI ever needs the plaintext back. A getter that
 * returned it would exist only to be misused.
 */
export async function listDomainsWithWebhookKeys(): Promise<
  Array<{ domainId: string; domainName: string; updatedAt: Date }>
> {
  return db
    .select({
      domainId: domainWebhookKeys.domainId,
      domainName: domains.name,
      updatedAt: domainWebhookKeys.updatedAt,
    })
    .from(domainWebhookKeys)
    .innerJoin(domains, eq(domainWebhookKeys.domainId, domains.id));
}
