import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { replyEmailSchema, type ReplyEmailInput } from '@/server/core/validation';
import { getOutboundService } from '@/server/mail/services';

export const POST = withApi<ReplyEmailInput>(
  async ({ body, params }) => {
    const email = await getOutboundService().reply(params.id, body);
    return NextResponse.json({ data: email }, { status: 201 });
  },
  { endpoint: '/v1/emails/reply', schema: replyEmailSchema },
);
