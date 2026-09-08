import { withApi } from '@/server/core/http';
import { repositories } from '@/server/repositories';

/**
 * Revokes a key. It is a timestamp, not a delete: an audit trail that loses the
 * key a request was made with is not an audit trail.
 *
 * Effective immediately — `resolveApiKey` checks `revoked_at` on every request
 * and nothing about a key is cached.
 */
export const DELETE = withApi(
  async ({ params }) => {
    await repositories.apiKeys.revoke(params.id);
    return new Response(null, { status: 204 });
  },
  {
    endpoint: '/v1/api-keys',
    audit: { action: 'api_key.revoke', resourceType: 'api_key' },
  },
);
