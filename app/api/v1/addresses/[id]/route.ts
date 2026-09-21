import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { updateAddressSchema } from '@/server/core/validation';
import { servicesFor } from '@/server/mail/services';

export const GET = withApi(
  async ({ params, tenantId }) => {
    const address = await servicesFor(tenantId).addresses().get(params.id);
    return NextResponse.json({ data: address });
  },
  { endpoint: '/v1/addresses' },
);

export const PATCH = withApi(
  async ({ params, body, tenantId }) => {
    const address = await servicesFor(tenantId).addresses().update(params.id, body);
    return NextResponse.json({ data: address });
  },
  {
    endpoint: '/v1/addresses',
    schema: updateAddressSchema,
    audit: { action: 'address.update', resourceType: 'address' },
  },
);

export const DELETE = withApi(
  async ({ params, tenantId }) => {
    await servicesFor(tenantId).addresses().delete(params.id);
    return NextResponse.json({ data: { id: params.id, deleted: true } });
  },
  {
    endpoint: '/v1/addresses',
    audit: { action: 'address.delete', resourceType: 'address' },
  },
);
