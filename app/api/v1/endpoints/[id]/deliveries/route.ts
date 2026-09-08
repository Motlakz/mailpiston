import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { repositories } from '@/server/repositories';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The delivery log for one endpoint: status, response code, last error, and
 * attempt count, newest first.
 *
 * This is what an operator reads when a customer says "your webhook never
 * fired" — the answer is usually that it fired and the receiver answered 500.
 */
export const GET = withApi(
  async ({ request, params }) => {
    const requested = Number(new URL(request.url).searchParams.get('limit'));
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_LIMIT)
        : DEFAULT_LIMIT;

    return NextResponse.json({
      data: await repositories.deliveries.listForEndpoint(params.id, limit),
    });
  },
  { endpoint: '/v1/endpoints' },
);
