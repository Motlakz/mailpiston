import { NextResponse } from 'next/server';

import { withProvider } from '@/server/core/http';
import { getOutboundService } from '@/server/mail/services';
import { mailProviderRegistry } from '@/server/providers/registry';

/**
 * Bounce and delivery events.
 *
 * Same authenticity rules as inbound. The event is recorded against the
 * message it names — matched on the provider's id first, since that is what
 * the provider itself is sure of — and an event for a message we do not hold
 * is still recorded, unattached: it is the answer to "where did that go?" for
 * mail sent before this deployment, or sent by something else on the account.
 */
export const POST = withProvider(
  async ({ payload }) => {
    const provider = mailProviderRegistry.active();
    const event = await provider.normalizeDeliveryEvent(payload);

    const { emailId } = await getOutboundService().recordDeliveryEvent({
      type: event.type,
      providerMessageId: event.providerMessageId,
      messageId: event.messageId,
      recipient: event.recipient,
      detail: event.detail,
    });

    return NextResponse.json({ received: true, emailId });
  },
  {
    provider: 'forward-email',
    endpoint: '/api/providers/forward-email/events',
  },
);
