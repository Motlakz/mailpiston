import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { isOperatorEmail } from '@/server/core/config';
import { AuthError, ForbiddenError } from '@/server/core/errors';
import { tenantForUser } from '@/server/core/tenancy/resolve';

import { auth } from './auth';

export interface OperatorSession {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  /**
   * The workspace this person is acting in.
   *
   * Resolved on every read rather than baked into the session cookie: a
   * membership that is revoked has to take effect now, not when the session
   * expires a month later — the same reasoning the allow-list check already
   * follows.
   */
  tenantId: string;
}

/** Reads the current session, or null. Never throws on an anonymous request. */
export async function getOperatorSession(): Promise<OperatorSession | null> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) return null;

  // The allow-list is re-checked on every read, not just at sign-in: removing
  // an address from ALLOWED_OPERATOR_EMAILS must take effect immediately, and
  // not on session expiry a month later.
  if (!isOperatorEmail(session.user.email)) return null;

  // No membership, no workspace, no session. A signed-in user who belongs to
  // nothing has nothing to read.
  const tenantId = await tenantForUser(session.user.id);
  if (!tenantId) return null;

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
    tenantId,
  };
}

/** Server-component guard: redirects to sign-in rather than throwing. */
export async function requireOperatorPage(): Promise<OperatorSession> {
  const session = await getOperatorSession();
  if (!session) redirect('/sign-in');
  return session;
}

/** Route-handler guard: throws the structured 401/403 the error model expects. */
export async function requireOperator(): Promise<OperatorSession> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) throw new AuthError();
  if (!isOperatorEmail(session.user.email)) {
    throw new ForbiddenError('Account is not an allow-listed operator');
  }

  const tenantId = await tenantForUser(session.user.id);
  if (!tenantId) {
    throw new ForbiddenError('Account does not belong to a workspace');
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
    tenantId,
  };
}
