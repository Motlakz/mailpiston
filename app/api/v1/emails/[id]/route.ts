import { NextResponse } from 'next/server';

import { NotFoundError } from '@/server/core/errors';
import { withApi } from '@/server/core/http';
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
