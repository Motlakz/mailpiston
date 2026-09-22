import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { servicesFor } from '@/server/mail/services';

export const GET = withApi(
  async ({ params, tenantId }) => {
    const domain = await servicesFor(tenantId).domains().get(params.id);
    return NextResponse.json({ data: domain });
  },
  { endpoint: '/v1/domains' },
);

export const DELETE = withApi(
  async ({ params, tenantId }) => {
    await servicesFor(tenantId).domains().delete(params.id);
    return NextResponse.json({ data: { id: params.id, deleted: true } });
  },
  {
    endpoint: '/v1/domains',
    audit: { action: 'domain.delete', resourceType: 'domain' },
  },
);
