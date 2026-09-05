import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/server/core/auth';

/**
 * Better Auth's own endpoints: the GitHub OAuth start and callback, session
 * reads, and sign-out. The allow-list that makes this single-operator lives in
 * the auth config's database hooks, not here.
 */
export const { GET, POST } = toNextJsHandler(auth);
