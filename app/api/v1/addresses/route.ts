import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { createAddressSchema } from '@/server/core/validation';
import { servicesFor } from '@/server/mail/services';

export const GET = withApi(
  async ({ request, tenantId }) => {
    const domainId = new URL(request.url).searchParams.get('domainId') ?? undefined;
    const addresses = await servicesFor(tenantId).addresses().list({ domainId });
    return NextResponse.json({ data: addresses });
  },
  { endpoint: '/v1/addresses' },
);

export const POST = withApi(
  async ({ body, tenantId }) => {
    const address = await servicesFor(tenantId).addresses().create(body);
    return NextResponse.json({ data: address }, { status: 201 });
  },
  {
    endpoint: '/v1/addresses',
    schema: createAddressSchema,
    audit: { action: 'address.create', resourceType: 'address' },
  },
);
