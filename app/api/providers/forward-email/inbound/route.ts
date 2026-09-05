import { NextResponse } from 'next/server';

import { withProvider } from '@/server/core/http';
import { mailProviderRegistry } from '@/server/providers/registry';

/**
 * Provider ingress.
 *
 * Phase 2 scope: the wrapper does the load-bearing part — raw body first, HMAC
 * verified before any spend, fail-open rate limiting — and this handler proves
 * the payload normalises. Persistence, recipient resolution, the idempotency
 * claim, and endpoint fan-out are Phase 4; until then a verified request is
 * acknowledged and dropped, deliberately and visibly.
 */
export const POST = withProvider(
  async ({ payload }) => {
    const provider = mailProviderRegistry.active();
    const normalized = await provider.normalizeInbound(payload);

    console.info('[forward-email] inbound accepted', {
      recipient: normalized.recipient,
      messageId: normalized.messageId,
      attachments: normalized.attachments.length,
    });

    return NextResponse.json({ received: true, persisted: false });
  },
  {
    provider: 'forward-email',
    endpoint: '/api/providers/forward-email/inbound',
  },
);
