import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { servicesFor } from '@/server/mail/services';

/** Polls the provider for the DNS records and records the outcome. */
export const POST = withApi(
  async ({ params, tenantId }) => {
    const domain = await servicesFor(tenantId).domains().verify(params.id);
    return NextResponse.json({ data: domain });
  },
  { endpoint: '/v1/domains' },
);
