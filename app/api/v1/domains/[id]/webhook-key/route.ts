import { NextResponse } from 'next/server';
import { z } from 'zod';

import { NotFoundError } from '@/server/core/errors';
import { withApi } from '@/server/core/http';
import {
  deleteDomainWebhookKey,
  setDomainWebhookKey,
} from '@/server/mail/domains/webhook-keys';
import { repositories } from '@/server/repositories';

const setWebhookKeySchema = z.object({
  webhookKey: z.string().min(8, 'A webhook key that short is not a real one'),
});

/**
 * The per-domain inbound webhook key.
 *
 * There is deliberately no `GET`. The stored key is only ever needed to
 * recompute an HMAC on the server; a route that handed the plaintext back
 * would exist purely to be misused, and the dashboard only needs to know
 * whether a key is configured — which the domains list already reports.
 */
export const PUT = withApi(
  async ({ params, body }) => {
    const domain = await repositories.domains.findById(params.id);
    if (!domain) throw new NotFoundError(`Domain ${params.id} not found`);

    await setDomainWebhookKey(domain.id, body.webhookKey.trim());

    return NextResponse.json({ data: { domainId: domain.id, configured: true } });
  },
  {
    endpoint: '/v1/domains',
    schema: setWebhookKeySchema,
    audit: { action: 'domain.webhook_key.set', resourceType: 'domain' },
  },
);

export const DELETE = withApi(
  async ({ params }) => {
    const domain = await repositories.domains.findById(params.id);
    if (!domain) throw new NotFoundError(`Domain ${params.id} not found`);

    await deleteDomainWebhookKey(domain.id);

    // Deleting the stored key does not disable ingress for this domain: the
    // FORWARD_EMAIL_WEBHOOK_KEY fallback still applies, exactly as it did
    // before any per-domain key was stored.
    return NextResponse.json({ data: { domainId: domain.id, configured: false } });
  },
  {
    endpoint: '/v1/domains',
    audit: { action: 'domain.webhook_key.remove', resourceType: 'domain' },
  },
);
