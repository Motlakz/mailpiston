import 'server-only';

import { eq } from 'drizzle-orm';

import { newId } from '@/server/core/ids';
import { db } from '@/server/db/client';
import { tenantMembers, tenants } from '@/server/db/schema';

/**
 * Giving a new account a workspace of its own.
 *
 * Without this, a second person signing in has a session and no membership,
 * which `getOperatorSession` correctly refuses — so they would authenticate
 * successfully and then be told they belong to nothing. The alternative
 * failure is worse: dropping everyone into the bootstrap workspace, where they
 * would read the operator's mail.
 *
 * Runs after the user row exists, and is idempotent — an account that already
 * belongs somewhere keeps that membership rather than gaining a second one.
 */
export async function provisionTenantForUser(input: {
  userId: string;
  email: string;
  name?: string | null;
}): Promise<string> {
  const existing = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, input.userId))
    .limit(1);

  if (existing[0]) return existing[0].tenantId;

  const tenantId = newId('tenant');

  await db.transaction(async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: workspaceName(input.name, input.email),
      slug: await uniqueSlug(tx, input.email),
    });

    await tx.insert(tenantMembers).values({
      tenantId,
      userId: input.userId,
      role: 'owner',
    });
  });

  return tenantId;
}

/** "Ada Lovelace" → `Ada Lovelace's workspace`; no name → the local part. */
function workspaceName(name: string | null | undefined, email: string): string {
  const label = name?.trim() || email.split('@')[0];
  return `${label}'s workspace`;
}

/**
 * A readable, unique handle.
 *
 * Derived from the email's local part because it is the only thing we reliably
 * have, then suffixed until it is free. The loop is bounded: a slug that
 * cannot be made unique in a handful of tries is a bug, not a collision, and
 * falling back to the tenant id keeps signup working rather than failing on
 * cosmetics.
 */
async function uniqueSlug(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  email: string,
): Promise<string> {
  const base =
    email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'workspace';

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;

    const [taken] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, candidate))
      .limit(1);

    if (!taken) return candidate;
  }

  return newId('tenant').toLowerCase();
}
