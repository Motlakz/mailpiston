import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { updateAddressSchema } from '@/server/core/validation';
import { getAddressService } from '@/server/mail/services';

export const GET = withApi(
  async ({ params }) => {
    const address = await getAddressService().get(params.id);
    return NextResponse.json({ data: address });
  },
  { endpoint: '/v1/addresses' },
);

export const PATCH = withApi(
  async ({ params, body }) => {
    const address = await getAddressService().update(params.id, body);
    return NextResponse.json({ data: address });
  },
  {
    endpoint: '/v1/addresses',
    schema: updateAddressSchema,
    audit: { action: 'address.update', resourceType: 'address' },
  },
);

export const DELETE = withApi(
  async ({ params }) => {
    await getAddressService().delete(params.id);
    return NextResponse.json({ data: { id: params.id, deleted: true } });
  },
  {
    endpoint: '/v1/addresses',
    audit: { action: 'address.delete', resourceType: 'address' },
  },
);
