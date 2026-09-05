import 'server-only';

import { and, eq, isNull, or, gt } from 'drizzle-orm';

import { AuthError } from '@/server/core/errors';
import { randomToken, sha256Hex } from '@/server/core/crypto';
import { db } from '@/server/db/client';
import { apiKeys } from '@/server/db/schema';

const KEY_PREFIX = 'mp_live_';
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 6;

export interface ApiKeyIdentity {
  id: string;
  name: string;
}

export interface IssuedApiKey {
  id: string;
  name: string;
  /** Shown exactly once. Never stored, never recoverable. */
  plaintext: string;
  keyPrefix: string;
}

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = `${KEY_PREFIX}${randomToken(24)}`;

  return {
    plaintext,
    // SHA-256 rather than a password hash on purpose: the key is 24 bytes of
    // CSPRNG output, so there is no low-entropy guess to slow down, and this
    // lookup runs on every API request.
    hash: sha256Hex(plaintext),
    prefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

/**
 * Resolves a bearer token to an API key identity, or throws `AuthError`.
 *
 * The lookup is by hash, so a stolen database gives an attacker nothing usable.
 */
export async function resolveApiKey(
  authorizationHeader: string | null,
): Promise<ApiKeyIdentity> {
  const token = parseBearer(authorizationHeader);
  if (!token) throw new AuthError('Missing API key');

  const now = new Date();

  const [row] = await db
    .select({ id: apiKeys.id, name: apiKeys.name })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyHash, sha256Hex(token)),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
      ),
    )
    .limit(1);

  if (!row) throw new AuthError('Invalid API key');

  // Fire-and-forget: last-used tracking must never fail or slow a request.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(eq(apiKeys.id, row.id))
    .catch((error: unknown) => {
      console.error('Failed to record API key usage', error);
    });

  return row;
}

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}
