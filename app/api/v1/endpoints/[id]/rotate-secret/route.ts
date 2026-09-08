import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { getEndpointService } from '@/server/mail/services';

/**
 * Mints a new signing secret and returns it once.
 *
 * Deliveries between this call and the receiver being redeployed will fail
 * verification. There is no way around that which does not also mean honouring
 * the old secret for a while — and a secret that is being rotated because it
 * leaked must stop working the moment it is rotated.
 */
export const POST = withApi(
  async ({ params }) => {
    const secret = await getEndpointService().rotateSecret(params.id);
    return NextResponse.json({ data: { secret } });
  },
  {
    endpoint: '/v1/endpoints',
    audit: { action: 'endpoint.secret.rotate', resourceType: 'endpoint' },
  },
);
