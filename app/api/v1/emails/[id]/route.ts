import { NextResponse } from 'next/server';

import { NotFoundError } from '@/server/core/errors';
import { withApi } from '@/server/core/http';
import { getMailboxService } from '@/server/mail/services';
import { repositories } from '@/server/repositories';

export const GET = withApi(
  async ({ params }) => {
    const email = await repositories.emails.findById(params.id);
    if (!email) throw new NotFoundError(`Email ${params.id} not found`);

    const attachments = await repositories.emails.listAttachments(email.id);

    // `storageKey` is internal: it names an object in a bucket the caller has
    // no business addressing directly. The download route is the only way in.
    return NextResponse.json({
      data: {
        ...email,
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          emailId: attachment.emailId,
          filename: attachment.filename,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          createdAt: attachment.createdAt,
        })),
      },
    });
  },
  { endpoint: '/v1/emails' },
);

/**
 * Two different deletions behind one verb (roadmap Phase 12).
 *
 * The default puts the message in the bin: one column, reversible, bytes
 * untouched. `?purge=true` destroys it, and is refused unless the message is
 * already binned — two deliberate steps for the one irreversible action in the
 * product.
 *
 * A query parameter rather than two routes because the caller's intent is
 * genuinely "delete this", and the difference between the two is how far. The
 * service enforces the ordering, so an API caller cannot skip the first step by
 * guessing the URL.
 */
export const DELETE = withApi(
  async ({ params, request }) => {
    const purge =
      new URL(request.url).searchParams.get('purge') === 'true';

    if (purge) {
      await getMailboxService().purge(params.id);
      return NextResponse.json({ data: { id: params.id, purged: true } });
    }

    const email = await getMailboxService().bin(params.id);
    return NextResponse.json({ data: email });
  },
  {
    endpoint: '/v1/emails',
    audit: { action: 'email.delete', resourceType: 'email' },
  },
);
