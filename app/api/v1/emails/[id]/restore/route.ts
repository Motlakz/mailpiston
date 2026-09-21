import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { servicesFor } from '@/server/mail/services';

/** Out of the bin again. The counterpart of `DELETE /v1/emails/{id}`. */
export const PUT = withApi(
  async ({ params, tenantId }) => {
    const email = await servicesFor(tenantId).mailbox().restore(params.id);
    return NextResponse.json({ data: email });
  },
  {
    endpoint: '/v1/emails',
    audit: { action: 'email.restore', resourceType: 'email' },
  },
);
