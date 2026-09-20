import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { createMailFilterSchema } from '@/server/core/validation';
import { repositories } from '@/server/repositories';

/**
 * The operator's standing allow and deny decisions (roadmap Phase 12).
 *
 * Global rather than per domain: one person runs several apps, and an agency
 * worth blocking on one is worth blocking on all of them.
 */
export const GET = withApi(
  async () => {
    const entries = await repositories.mailFilters.list();
    return NextResponse.json({ data: entries });
  },
  { endpoint: '/v1/mail-filters' },
);

export const POST = withApi(
  async ({ body }) => {
    const entry = await repositories.mailFilters.add(body);
    return NextResponse.json({ data: entry }, { status: 201 });
  },
  {
    endpoint: '/v1/mail-filters',
    schema: createMailFilterSchema,
    audit: { action: 'mail_filter.create', resourceType: 'mail_filter' },
  },
);
