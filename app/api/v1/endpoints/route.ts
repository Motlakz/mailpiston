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

/**
 * `secret` is in this response and in no other, ever.
 *
 * A webhook signing secret has to be recoverable by the server — it signs every
 * delivery — so it is encrypted rather than hashed. That makes "show it once"
 * the only thing standing between an encrypted column and a read endpoint that
 * hands it back. Losing it means rotating it, which is a button.
 */
export const POST = withApi<CreateEndpointInput>(
  async ({ body }) => {
    const { endpoint, secret } = await getEndpointService().create(body);
    return NextResponse.json({ data: { ...endpoint, secret } }, { status: 201 });
  },
  { endpoint: '/v1/endpoints', schema: createEndpointSchema },
);
