import { createAuthClient } from 'better-auth/react';

/**
 * Browser-side auth client. Client-safe by construction: it holds no secret and
 * talks only to `/api/auth/*` on this origin.
 */
export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
