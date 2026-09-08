import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { createDomainSchema } from '@/server/core/validation';
import { getDomainService } from '@/server/mail/services';

export const GET = withApi(
  async () => {
    const domains = await getDomainService().list();
    return NextResponse.json({ data: domains });
  },
  { endpoint: '/v1/domains' },
);

export const POST = withApi(
  async ({ body }) => {
    const domain = await getDomainService().create(body);
    return NextResponse.json({ data: domain }, { status: 201 });
  },
  {
    endpoint: '/v1/domains',
    schema: createDomainSchema,
    audit: { action: 'domain.create', resourceType: 'domain' },
  },
);
