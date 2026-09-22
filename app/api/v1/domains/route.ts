import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { createDomainSchema } from '@/server/core/validation';
import { servicesFor } from '@/server/mail/services';

export const GET = withApi(
  async ({ tenantId }) => {
    const domains = await servicesFor(tenantId).domains().list();
    return NextResponse.json({ data: domains });
  },
  { endpoint: '/v1/domains' },
);

export const POST = withApi(
  async ({ body, tenantId }) => {
    const domain = await servicesFor(tenantId).domains().create(body);
    return NextResponse.json({ data: domain }, { status: 201 });
  },
  {
    endpoint: '/v1/domains',
    schema: createDomainSchema,
    audit: { action: 'domain.create', resourceType: 'domain' },
  },
);
