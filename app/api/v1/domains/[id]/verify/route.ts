import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { getDomainService } from '@/server/mail/services';

/** Polls the provider for the DNS records and records the outcome. */
export const POST = withApi(
  async ({ params }) => {
    const domain = await getDomainService().verify(params.id);
    return NextResponse.json({ data: domain });
  },
  { endpoint: '/v1/domains' },
);
