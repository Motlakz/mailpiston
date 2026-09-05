import { NextResponse } from 'next/server';

import { withProvider } from '@/server/core/http';
import { mailProviderRegistry } from '@/server/providers/registry';

/**
 * Bounce and delivery events. Same authenticity rules as inbound; the
 * normalised event is recorded against an email in Phase 4.
 */
export const POST = withProvider(
  async ({ payload }) => {
    const provider = mailProviderRegistry.active();
    const event = await provider.normalizeDeliveryEvent(payload);

    console.info('[forward-email] delivery event accepted', {
      type: event.type,
      messageId: event.messageId,
      recipient: event.recipient,
    });

    return NextResponse.json({ received: true, persisted: false });
  },
  {
    provider: 'forward-email',
    endpoint: '/api/providers/forward-email/events',
  },
);
