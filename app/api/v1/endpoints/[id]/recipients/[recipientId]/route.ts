import { withApi } from '@/server/core/http';
import { getEndpointService } from '@/server/mail/services';

export const DELETE = withApi(
  async ({ params }) => {
    await getEndpointService().removeRecipient(params.recipientId);
    return new Response(null, { status: 204 });
  },
  { endpoint: '/v1/endpoints' },
);
