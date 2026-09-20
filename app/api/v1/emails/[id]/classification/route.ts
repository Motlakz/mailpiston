import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { reclassifyEmailSchema } from '@/server/core/validation';
import { getMailboxService } from '@/server/mail/services';

/**
 * "This is spam" / "this is not spam" (roadmap Phase 12).
 *
 * `PUT` because it is idempotent: saying the same thing twice is the same
 * state. Releasing a message does not retro-fire the fan-out — see
 * `MailboxService.reclassify`.
 */
export const PUT = withApi(
  async ({ params, body }) => {
    const email = await getMailboxService().reclassify(
      params.id,
      body.spamVerdict,
    );
    return NextResponse.json({ data: email });
  },
  {
    endpoint: '/v1/emails',
    schema: reclassifyEmailSchema,
    audit: { action: 'email.reclassify', resourceType: 'email' },
  },
);
