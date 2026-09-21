import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import {
  addRecipientSchema,
  type AddRecipientInput,
} from '@/server/core/validation';
import { servicesFor } from '@/server/mail/services';

export const GET = withApi(
  async ({ params, tenantId }) =>
    NextResponse.json({
      data: await servicesFor(tenantId).endpoints().listRecipients(params.id),
    }),
  { endpoint: '/v1/endpoints' },
);

/** Created unverified. Nothing is forwarded until a challenge is confirmed. */
export const POST = withApi<AddRecipientInput>(
  async ({ body, params, tenantId }) => {
    const recipient = await servicesFor(tenantId).endpoints().addRecipient(
      params.id,
      body.email,
    );

    return NextResponse.json({ data: recipient }, { status: 201 });
  },
  { endpoint: '/v1/endpoints', schema: addRecipientSchema },
);
