import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { sendEmailSchema, type SendEmailInput } from '@/server/core/validation';
import { getOutboundService } from '@/server/mail/services';

/**
 * Fail-closed on the limiter (plan §9.5): this spends the provider's send
 * quota, and a limiter outage must not become an open relay.
 */
export const POST = withApi<SendEmailInput>(
  async ({ body }) => {
    const email = await getOutboundService().send(body);
    return NextResponse.json({ data: email }, { status: 201 });
  },
  { endpoint: '/v1/emails/send', schema: sendEmailSchema },
);
