import { withApi } from '@/server/core/http';
import { getEndpointService } from '@/server/mail/services';

export const DELETE = withApi(
  async ({ params }) => {
    await getEndpointService().unbind(params.id, params.endpointId);
    return new Response(null, { status: 204 });
  },
  { endpoint: '/v1/addresses' },
);
