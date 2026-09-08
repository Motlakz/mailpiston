import { NextResponse } from 'next/server';

import { GoneError, NotFoundError } from '@/server/core/errors';
import { withApi } from '@/server/core/http';
import { repositories } from '@/server/repositories';
import { getStorage } from '@/server/storage';

/** Long enough to click, short enough that a leaked URL expires by itself. */
const PRESIGNED_TTL_SECONDS = 300;

/**
 * Attachment download.
 *
 * Redirects to a presigned URL when the driver can mint one, so the bytes go
 * straight from the bucket to the browser and never occupy a function's
 * memory. The filesystem driver cannot, so this streams instead — the same
 * route works in both, and nothing upstream has to know which is in use.
 *
 * Either way the caller is authenticated first: the bucket is private, and a
 * presigned URL is only ever handed to someone who has already proved they may
 * have it.
 */
export const GET = withApi(
  async ({ params }) => {
    const attachment = await repositories.emails.findAttachment(params.id);
    if (!attachment) throw new NotFoundError(`Attachment ${params.id} not found`);

    // The row outlives its bytes (Phase 11 retention). A 404 here would say
    // "there is no such attachment", which is false and sends the operator
    // looking for a bug; 410 says it was real and we removed it on purpose.
    if (attachment.prunedAt) {
      throw new GoneError(
        `${attachment.filename} was removed by retention on ${attachment.prunedAt.toISOString().slice(0, 10)}`,
      );
    }

    const storage = getStorage();
    const url = await storage.presignedUrl(
      attachment.storageKey,
      PRESIGNED_TTL_SECONDS,
    );

    if (url) return NextResponse.redirect(url, 302);

    const bytes = await storage.get(attachment.storageKey);

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': attachment.contentType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="${attachment.filename.replace(/[^\w.\- ]+/g, '_')}"`,
        // Attachments arrive from strangers. Nothing here should ever be
        // interpreted by the browser as part of this origin.
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
  { endpoint: '/v1/attachments' },
);
