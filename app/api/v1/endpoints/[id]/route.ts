import { NextResponse } from 'next/server';

import { NotFoundError } from '@/server/core/errors';
import { withApi } from '@/server/core/http';
import {
  updateEndpointSchema,
  type UpdateEndpointInput,
} from '@/server/core/validation';
import { servicesFor } from '@/server/mail/services';

export const GET = withApi(
  async ({ params, tenantId }) => {
    const service = servicesFor(tenantId).endpoints();
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
  async ({ body, params, tenantId }) => {
    const endpoint = await servicesFor(tenantId).endpoints().update(params.id, body);
    return NextResponse.json({ data: endpoint });
  },
  {
    endpoint: '/v1/endpoints',
    schema: updateEndpointSchema,
    audit: { action: 'endpoint.update', resourceType: 'endpoint' },
  },
);

export const DELETE = withApi(
  async ({ params, tenantId }) => {
    await servicesFor(tenantId).endpoints().delete(params.id);
    return new Response(null, { status: 204 });
  },
  {
    endpoint: '/v1/endpoints',
    audit: { action: 'endpoint.delete', resourceType: 'endpoint' },
  },
);
