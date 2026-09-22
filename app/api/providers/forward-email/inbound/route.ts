import { NextResponse } from 'next/server';

import { withProvider } from '@/server/core/http';
import { tenantForInboundRecipient } from '@/server/core/tenancy/resolve';
import { servicesFor } from '@/server/mail/services';
import { mailProviderRegistry } from '@/server/providers/registry';

/**
 * Provider ingress (roadmap Phase 4).
 *
 * The wrapper owns the parts that must happen before anything is spent: raw
 * body first, HMAC verified, rate limited fail-open. This handler owns
 * everything after — normalise, then hand the result to `InboundService`,
 * which resolves the recipient, stores bytes, and writes the message.
 *
 * The response body is the operator's only view of what happened when they
 * replay a request by hand, so it names the outcome rather than just
 * acknowledging receipt.
 */
export const POST = withProvider(
  async ({ payload }) => {
    // Normalising needs no credentials — it is pure parsing of a body whose
    // signature the wrapper already verified.
    const provider = mailProviderRegistry.active();
    const normalized = await provider.normalizeInbound(payload);

    // Nothing in the request says whose workspace this is; the recipient does.
    const tenantId = await tenantForInboundRecipient(normalized.recipient);

    if (!tenantId) {
      // No tenant owns this recipient. Answered 200 on purpose: a catch-all
      // receives mail for local parts that do not exist, and bouncing it is
      // backscatter (roadmap §1.2).
      return NextResponse.json({
        received: true,
        status: 'rejected',
        reason: 'no_tenant_for_recipient',
      });
    }

    const result = await servicesFor(tenantId).inbound().capture(normalized);

    return NextResponse.json({
      received: true,
      status: result.status,
      emailId: result.emailId,
      duplicate: result.status === 'duplicate',
      ...(result.reason ? { reason: result.reason } : {}),
    });
  },
  {
    provider: 'forward-email',
    endpoint: '/api/providers/forward-email/inbound',
  },
);
