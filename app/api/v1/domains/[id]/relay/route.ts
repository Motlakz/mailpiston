import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { servicesFor } from '@/server/mail/services';

/** Selects this verified domain for workspace reply tokens and repairs ingress. */
export const PUT = withApi(
  async ({ params, tenantId }) => {
    const domain = await servicesFor(tenantId).domains().configureRelay(params.id);
    return NextResponse.json({ data: domain });
  },
  {
    endpoint: '/v1/domains',
    audit: { action: 'domain.relay.configure', resourceType: 'domain' },
  },
);

/** Stops issuing new reply tokens on this domain. Existing tokens remain valid. */
export const DELETE = withApi(
  async ({ params, tenantId }) => {
    const domain = await servicesFor(tenantId).domains().disableRelay(params.id);
    return NextResponse.json({ data: domain });
  },
  {
    endpoint: '/v1/domains',
    audit: { action: 'domain.relay.disable', resourceType: 'domain' },
  },
);
