import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import {
  senderDecisionSchema,
  type SenderDecisionInput,
} from '@/server/core/validation';
import { servicesFor } from '@/server/mail/services';

/**
 * "Always trust" / "always block" the sender of this message.
 *
 * A decision about the person, not the message: it writes an allow or deny
 * entry (the same rows Settings edits) and moves the sender's other mail to
 * match. `POST` rather than `PUT` because the side effects on other messages
 * are not something a retry should be assumed to repeat harmlessly — though in
 * practice a second call finds the entry present and moves nothing.
 */
export const POST = withApi<SenderDecisionInput>(
  async ({ params, body, tenantId }) => {
    const result = await servicesFor(tenantId)
      .senders()
      .decideForEmail(params.id, body.decision, body.scope);

    return NextResponse.json({ data: result });
  },
  {
    endpoint: '/v1/emails',
    schema: senderDecisionSchema,
    audit: { action: 'email.sender_decision', resourceType: 'email' },
  },
);
