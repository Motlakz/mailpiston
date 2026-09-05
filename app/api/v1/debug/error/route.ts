import { withApi } from '@/server/core/http';
import { ConflictError } from '@/server/core/errors';

/**
 * Proves the error path end to end (roadmap Phase 1 acceptance): an `APIError`
 * thrown inside a handler must come back as the documented JSON body with the
 * matching status, not as a Next.js 500 page.
 *
 * It is behind the same auth and rate limiting as every other `/v1` route, so
 * it is not an unauthenticated way to make the server throw.
 */
export const GET = withApi(
  async () => {
    throw new ConflictError('Deliberate failure from the error-path probe');
  },
  { endpoint: '/v1/debug/error' },
);
