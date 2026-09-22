import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { repositoriesFor } from '@/server/repositories';

export const DELETE = withApi(
  async ({ params, tenantId }) => {
    const repositories = repositoriesFor(tenantId);
    await repositories.mailFilters.remove(params.id);
    return NextResponse.json({ data: { id: params.id, deleted: true } });
  },
  {
    endpoint: '/v1/mail-filters',
    audit: { action: 'mail_filter.delete', resourceType: 'mail_filter' },
  },
);
