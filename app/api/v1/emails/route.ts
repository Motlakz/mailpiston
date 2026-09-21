import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import type { EmailStatus, SpamVerdict } from '@/server/core/types';
import { repositories } from '@/server/repositories';

export const GET = withApi(
  async ({ request }) => {
    const params = new URL(request.url).searchParams;
    const direction = params.get('direction');

    /**
     * Repeatable filters, so `?status=soft_bounced&status=hard_bounced` reads
     * the way the dashboard's "Bounced" view is defined rather than forcing a
     * caller to make two requests and merge them.
     */
    const statuses = params.getAll('status').filter(isEmailStatus);
    const spamVerdicts = params.getAll('spamVerdict').filter(isSpamVerdict);
    const deleted = params.get('deleted');

    const page = await repositories.emails.list({
      direction: direction === 'inbound' || direction === 'outbound' ? direction : undefined,
      addressId: params.get('addressId') ?? undefined,
      threadId: params.get('threadId') ?? undefined,
      statuses: statuses.length > 0 ? statuses : undefined,
      spamVerdicts: spamVerdicts.length > 0 ? spamVerdicts : undefined,
      // Quarantined and binned mail is opted into everywhere in the stack: a
      // request that does not ask gets neither.
      deleted: deleted === 'true' ? true : undefined,
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      cursor: params.get('cursor'),
    });

    return NextResponse.json({ data: page.items, nextCursor: page.nextCursor });
  },
  { endpoint: '/v1/emails' },
);

const EMAIL_STATUSES: readonly EmailStatus[] = [
  'received', 'queued', 'sent', 'delivered', 'soft_bounced', 'hard_bounced', 'failed',
];

const SPAM_VERDICTS: readonly SpamVerdict[] = ['clean', 'suspicious', 'spam'];

function isEmailStatus(value: string): value is EmailStatus {
  return (EMAIL_STATUSES as readonly string[]).includes(value);
}

function isSpamVerdict(value: string): value is SpamVerdict {
  return (SPAM_VERDICTS as readonly string[]).includes(value);
}
