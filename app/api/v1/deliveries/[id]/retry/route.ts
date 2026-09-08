import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { getWebhookService } from '@/server/mail/services';

/**
 * Retry one delivery now.
 *
 * It requeues and then goes through the same atomic claim every scheduled
 * attempt uses — no shortcut. An operator presses this exactly when a
 * scheduled retry is due, so a path that skipped the claim would be the easiest
 * way in the system to deliver the same event twice.
 *
 * A delivery that is already delivered, or in flight right now, comes back
 * `skipped` rather than as an error: nothing went wrong, and there was simply
 * nothing to do.
 */
export const POST = withApi(
  async ({ params }) => {
    const result = await getWebhookService().retry(params.id);
    return NextResponse.json({ data: result });
  },
  {
    endpoint: '/v1/deliveries',
    audit: { action: 'delivery.retry', resourceType: 'delivery' },
  },
);
