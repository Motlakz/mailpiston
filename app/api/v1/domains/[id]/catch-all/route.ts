import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { getDomainService } from '@/server/mail/services';

/**
 * The catch-all is opt-in and reversible. Turning it on means receiving mail
 * for every local part on the domain, including ones that do not exist.
 */
export const POST = withApi(
  async ({ params }) => {
    const domain = await getDomainService().createCatchAll(params.id);
    return NextResponse.json({ data: domain }, { status: 201 });
  },
  { endpoint: '/v1/domains' },
);

/**
 * Repairs a drifted catch-all: recreates it if it is gone, repoints it at our
 * current ingress if it is not.
 *
 * A `PUT` rather than a second `POST` because it is idempotent — running it on
 * a healthy domain changes nothing. It exists only as an operator action:
 * reconciliation detects drift and stops, because an automatic repair racing
 * somebody mid-change turns a visible problem into two writers disagreeing.
 */
export const PUT = withApi(
  async ({ params }) => {
    const domain = await getDomainService().repairCatchAll(params.id);
    return NextResponse.json({ data: domain });
  },
  { endpoint: '/v1/domains' },
);

export const DELETE = withApi(
  async ({ params }) => {
    const domain = await getDomainService().removeCatchAll(params.id);
    return NextResponse.json({ data: domain });
  },
  { endpoint: '/v1/domains' },
);
