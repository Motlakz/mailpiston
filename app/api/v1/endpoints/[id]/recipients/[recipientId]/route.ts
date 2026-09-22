import { withApi } from '@/server/core/http';
import { servicesFor } from '@/server/mail/services';

export const DELETE = withApi(
  async ({ params, tenantId }) => {
    await servicesFor(tenantId).endpoints().removeRecipient(params.recipientId);
    return new Response(null, { status: 204 });
  },
  { endpoint: '/v1/endpoints' },
);
