import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { getOutboundQuota } from '@/server/mail/emails/quota';

/** The provider's own send accounting, cached briefly (roadmap Phase 6). */
export const GET = withApi(
  async () => NextResponse.json({ data: await getOutboundQuota() }),
  { endpoint: '/v1/emails' },
);
