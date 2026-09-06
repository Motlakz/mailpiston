import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import {
  createEndpointSchema,
  type CreateEndpointInput,
} from '@/server/core/validation';
import { getEndpointService } from '@/server/mail/services';

export const GET = withApi(
  async () => NextResponse.json({ data: await getEndpointService().list() }),
  { endpoint: '/v1/endpoints' },
);

export const POST = withApi<CreateEndpointInput>(
  async ({ body }) => {
    const endpoint = await getEndpointService().create(body);
    return NextResponse.json({ data: endpoint }, { status: 201 });
  },
  { endpoint: '/v1/endpoints', schema: createEndpointSchema },
);
