import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { getMailboxService } from '@/server/mail/services';

/** Out of the bin again. The counterpart of `DELETE /v1/emails/{id}`. */
export const PUT = withApi(
  async ({ params }) => {
    const email = await getMailboxService().restore(params.id);
    return NextResponse.json({ data: email });
  },
  {
    endpoint: '/v1/emails',
    audit: { action: 'email.restore', resourceType: 'email' },
  },
);
