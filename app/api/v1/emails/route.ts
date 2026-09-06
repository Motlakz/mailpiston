import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { repositories } from '@/server/repositories';

export const GET = withApi(
  async ({ request }) => {
    const params = new URL(request.url).searchParams;
    const direction = params.get('direction');

    const page = await repositories.emails.list({
      direction: direction === 'inbound' || direction === 'outbound' ? direction : undefined,
      addressId: params.get('addressId') ?? undefined,
      threadId: params.get('threadId') ?? undefined,
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      cursor: params.get('cursor'),
    });

    return NextResponse.json({ data: page.items, nextCursor: page.nextCursor });
  },
  { endpoint: '/v1/emails' },
);
