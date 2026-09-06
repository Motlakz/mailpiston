import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import {
  verifyRecipientSchema,
  type VerifyRecipientInput,
} from '@/server/core/validation';
import { getEndpointService } from '@/server/mail/services';

/**
 * Proof of control, in two steps on one route: `send` mails a code to the
 * address, `confirm` presents it back.
 */
export const POST = withApi<VerifyRecipientInput>(
  async ({ body, params }) => {
    const service = getEndpointService();

    if (body.action === 'send') {
      const { expiresAt } = await service.sendRecipientChallenge(
        params.recipientId,
        body.fromAddressId,
      );

      return NextResponse.json({ data: { sent: true, expiresAt } });
    }

    const recipient = await service.confirmRecipient(
      params.recipientId,
      body.token,
    );

    return NextResponse.json({ data: recipient });
  },
  { endpoint: '/v1/endpoints', schema: verifyRecipientSchema },
);
