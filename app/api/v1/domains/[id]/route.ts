import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { getDomainService } from '@/server/mail/services';

export const GET = withApi(
  async ({ params }) => {
    const domain = await getDomainService().get(params.id);
    return NextResponse.json({ data: domain });
  },
  { endpoint: '/v1/domains' },
);

export const DELETE = withApi(
  async ({ params }) => {
    await getDomainService().delete(params.id);
    return NextResponse.json({ data: { id: params.id, deleted: true } });
  },
  { endpoint: '/v1/domains' },
);
