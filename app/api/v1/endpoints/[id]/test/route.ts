import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { getWebhookService } from '@/server/mail/services';

/**
 * Sends a sample delivery to the endpoint and reports what came back.
 *
 * A receiver that rejects this would have rejected a real message, so it is
 * worth finding out before a customer's mail is the thing being dropped. The
 * result is 200 whatever the receiver said: their 500 is an answer to the
 * operator's question, not a failure of this request.
 */
export const POST = withApi(
  async ({ params }) => {
    const result = await getWebhookService().test(params.id);
    return NextResponse.json({ data: result });
  },
  { endpoint: '/v1/endpoints' },
);
