import { NextResponse } from 'next/server';

import { NotFoundError } from '@/server/core/errors';
import { withApi } from '@/server/core/http';
import {
  updateEndpointSchema,
  type UpdateEndpointInput,
} from '@/server/core/validation';
import { getEndpointService } from '@/server/mail/services';

export const GET = withApi(
  async ({ params }) => {
    const service = getEndpointService();
    const endpoint = await service.get(params.id);
    if (!endpoint) throw new NotFoundError(`Endpoint ${params.id} not found`);

    // The URL comes back; the signing secret never does.
    return NextResponse.json({
      data: {
        ...endpoint,
        url: await service.webhookUrl(endpoint.id),
        recipients: await service.listRecipients(endpoint.id),
      },
    });
  },
  { endpoint: '/v1/endpoints' },
);

export const PATCH = withApi<UpdateEndpointInput>(
  async ({ body, params }) => {
    const endpoint = await getEndpointService().update(params.id, body);
    return NextResponse.json({ data: endpoint });
  },
  { endpoint: '/v1/endpoints', schema: updateEndpointSchema },
);

export const DELETE = withApi(
  async ({ params }) => {
    await getEndpointService().delete(params.id);
    return new Response(null, { status: 204 });
  },
  { endpoint: '/v1/endpoints' },
);
