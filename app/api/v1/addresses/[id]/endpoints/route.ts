import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import {
  bindEndpointSchema,
  type BindEndpointInput,
} from '@/server/core/validation';
import { getEndpointService } from '@/server/mail/services';

export const GET = withApi(
  async ({ params }) =>
    NextResponse.json({
      data: await getEndpointService().listForAddress(params.id),
    }),
  { endpoint: '/v1/addresses' },
);

export const POST = withApi<BindEndpointInput>(
  async ({ body, params }) => {
    await getEndpointService().bind(params.id, body.endpointId);
    return NextResponse.json({ data: { bound: true } }, { status: 201 });
  },
  { endpoint: '/v1/addresses', schema: bindEndpointSchema },
);
