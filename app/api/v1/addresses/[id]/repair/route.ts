import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { getAddressService } from '@/server/mail/services';

/**
 * Repoints a drifted address alias at our current ingress (roadmap Phase 10).
 *
 * The sibling of `PUT /v1/domains/{id}/catch-all`, and it exists for the same
 * reason: reconciliation detects drift and stops, so every repair is a button
 * a person presses after reading the finding. Without this route the dashboard
 * could report `recipient_not_our_ingress` on a concrete address and then offer
 * nothing to do about it — which is how "Check again" comes to look broken when
 * it is working exactly as designed.
 *
 * `PUT` because it is idempotent: running it against a healthy alias rewrites
 * the same recipient and changes nothing.
 */
export const PUT = withApi(
  async ({ params }) => {
    const address = await getAddressService().repairAlias(params.id);
    return NextResponse.json({ data: address });
  },
  {
    endpoint: '/v1/addresses',
    audit: { action: 'address.alias.repair', resourceType: 'address' },
  },
);
