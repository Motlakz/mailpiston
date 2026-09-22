import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import {
  bindEndpointSchema,
  type BindEndpointInput,
} from '@/server/core/validation';
import { servicesFor } from '@/server/mail/services';

export const GET = withApi(
  async ({ params, tenantId }) =>
    NextResponse.json({
      data: await servicesFor(tenantId).endpoints().listForAddress(params.id),
    }),
  { endpoint: '/v1/addresses' },
);

export const POST = withApi<BindEndpointInput>(
  async ({ body, params, tenantId }) => {
    await servicesFor(tenantId).endpoints().bind(params.id, body.endpointId);
    return NextResponse.json({ data: { bound: true } }, { status: 201 });
  },
  { endpoint: '/v1/addresses', schema: bindEndpointSchema },
);
