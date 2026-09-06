import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import {
  addRecipientSchema,
  type AddRecipientInput,
} from '@/server/core/validation';
import { getEndpointService } from '@/server/mail/services';

export const GET = withApi(
  async ({ params }) =>
    NextResponse.json({
      data: await getEndpointService().listRecipients(params.id),
    }),
  { endpoint: '/v1/endpoints' },
);

/** Created unverified. Nothing is forwarded until a challenge is confirmed. */
export const POST = withApi<AddRecipientInput>(
  async ({ body, params }) => {
    const recipient = await getEndpointService().addRecipient(
      params.id,
      body.email,
    );

    return NextResponse.json({ data: recipient }, { status: 201 });
  },
  { endpoint: '/v1/endpoints', schema: addRecipientSchema },
);
