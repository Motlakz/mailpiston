import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { repositories } from '@/server/repositories';

export const GET = withApi(
  async ({ request }) => {
    const params = new URL(request.url).searchParams;

    const page = await repositories.threads.list({
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      cursor: params.get('cursor'),
    });

    return NextResponse.json({ data: page.items, nextCursor: page.nextCursor });
  },
  { endpoint: '/v1/threads' },
);
