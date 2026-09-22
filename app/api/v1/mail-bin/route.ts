import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { servicesFor } from '@/server/mail/services';
import { repositoriesFor } from '@/server/repositories';

/** Everything currently in the bin, newest first. */
export const GET = withApi(
  async ({ tenantId }) => {
    const repositories = repositoriesFor(tenantId);
    const page = await repositories.emails.list({
      deleted: true,
      // The bin holds whatever was put in it, including quarantined mail an
      // operator binned from the Spam view. Filtering by verdict here would
      // make some binned messages unreachable from the only screen that can
      // restore them.
      spamVerdicts: ['clean', 'suspicious', 'spam'],
      limit: 200,
    });

    return NextResponse.json({ data: page });
  },
  { endpoint: '/v1/mail-bin' },
);

/**
 * Empties the bin permanently.
 *
 * The one irreversible bulk action in the product. It only ever touches
 * messages that were already binned by hand, which is what makes it safe
 * enough to exist at all.
 */
export const DELETE = withApi(
  async ({ tenantId }) => {
    const result = await servicesFor(tenantId).mailbox().emptyBin();
    return NextResponse.json({ data: result });
  },
  {
    endpoint: '/v1/mail-bin',
    audit: { action: 'mail_bin.empty', resourceType: 'email' },
  },
);
