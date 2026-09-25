import { withApi } from '@/server/core/http';
import { ConflictError } from '@/server/core/errors';
import { repositoriesFor } from '@/server/repositories';

/**
 * Revokes an active key, or removes it after revocation when `remove=true`.
 *
 * Revocation is effective immediately. Removal is a deliberate second step;
 * audit entries keep the historical actor id after the credential row is gone.
 */
export const DELETE = withApi(
  async ({ params, tenantId, request }) => {
    const repositories = repositoriesFor(tenantId);
    const remove = new URL(request.url).searchParams.get('remove') === 'true';

    if (remove) {
      const deleted = await repositories.apiKeys.deleteRevoked(params.id);
      if (!deleted) {
        throw new ConflictError('Only a revoked API key can be removed');
      }
      return new Response(null, { status: 204 });
    }

    await repositories.apiKeys.revoke(params.id);
    return new Response(null, { status: 204 });
  },
  {
    endpoint: '/v1/api-keys',
    audit: { action: 'api_key.revoke_or_remove', resourceType: 'api_key' },
  },
);
