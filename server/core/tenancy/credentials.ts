import 'server-only';

import { and, eq } from 'drizzle-orm';

import { env } from '@/server/core/config';
import { decryptSecret, encryptSecret } from '@/server/core/crypto';
import { ConflictError } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { tenantProviderCredentials } from '@/server/db/schema';

/**
 * Each tenant's own provider credentials.
 *
 * Encrypted rather than hashed, because the server has to *use* the token to
 * call the provider — the same trade already made for endpoint signing
 * secrets, under the same `SECRET_ENCRYPTION_KEY`. A hash would be safer and
 * useless.
 *
 * Nothing above this module ever sees ciphertext or plaintext: the only export
 * that returns a token hands it straight to the provider client, and the
 * dashboard is told whether a credential exists, never what it is.
 */

/**
 * Cached, because it is read on the path of every provider call and a decrypt
 * plus a round trip per API request is a cost with no payoff — the row changes
 * only when an operator rotates it, and `forgetTenantToken` covers that.
 */
const cache = new Map<string, string>();

export async function tenantApiToken(tenantId: string): Promise<string> {
  const cached = cache.get(tenantId);
  if (cached) return cached;

  const [row] = await db
    .select({ ciphertext: tenantProviderCredentials.apiTokenCiphertext })
    .from(tenantProviderCredentials)
    .where(
      and(
        eq(tenantProviderCredentials.tenantId, tenantId),
        eq(tenantProviderCredentials.provider, env.MAIL_PROVIDER),
      ),
    )
    .limit(1);

  if (!row) {
    // Not an internal error: a workspace that has not finished onboarding is a
    // normal state, and the message has to say what to do about it.
    throw new ConflictError(
      'No mail provider is connected to this workspace. Add your provider API key in Settings before sending or receiving mail.',
    );
  }

  const token = decryptSecret(row.ciphertext);
  cache.set(tenantId, token);
  return token;
}

/** Stores or replaces a tenant's token. Returns nothing — deliberately. */
export async function setTenantApiToken(
  tenantId: string,
  apiToken: string,
): Promise<void> {
  const ciphertext = encryptSecret(apiToken.trim());

  await db
    .insert(tenantProviderCredentials)
    .values({
      tenantId,
      provider: env.MAIL_PROVIDER,
      apiTokenCiphertext: ciphertext,
    })
    .onConflictDoUpdate({
      target: [
        tenantProviderCredentials.tenantId,
        tenantProviderCredentials.provider,
      ],
      set: {
        apiTokenCiphertext: ciphertext,
        // A replaced token is unproven again until something uses it.
        verifiedAt: null,
        updatedAt: new Date(),
      },
    });

  forgetTenantToken(tenantId);
}

/** Whether this workspace has a provider connected, without revealing it. */
export async function hasTenantApiToken(tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ tenantId: tenantProviderCredentials.tenantId })
    .from(tenantProviderCredentials)
    .where(
      and(
        eq(tenantProviderCredentials.tenantId, tenantId),
        eq(tenantProviderCredentials.provider, env.MAIL_PROVIDER),
      ),
    )
    .limit(1);

  return Boolean(row);
}

/** Records that the stored token actually worked. */
export async function markTenantTokenVerified(tenantId: string): Promise<void> {
  await db
    .update(tenantProviderCredentials)
    .set({ verifiedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(tenantProviderCredentials.tenantId, tenantId),
        eq(tenantProviderCredentials.provider, env.MAIL_PROVIDER),
      ),
    );
}

/** Drops the cached plaintext — call after any rotation. */
export function forgetTenantToken(tenantId: string): void {
  cache.delete(tenantId);
}
