import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import {
  bulkEmailActionSchema,
  type BulkEmailActionInput,
} from '@/server/core/validation';
import { servicesFor } from '@/server/mail/services';

export const POST = withApi<BulkEmailActionInput>(
  async ({ body, tenantId }) => {
    const mailbox = servicesFor(tenantId).mailbox();
    const ids = [...new Set(body.ids)];
    const failures: Array<{ id: string; message: string }> = [];
    let changed = 0;
    const queue = [...ids];

    await Promise.all(
      Array.from({ length: Math.min(10, queue.length) }, async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          try {
            if (body.action === 'purge') await mailbox.purge(id);
            else await mailbox.bin(id);
            changed += 1;
          } catch (error) {
            failures.push({ id, message: (error as Error).message });
          }
        }
      }),
    );

    return NextResponse.json({
      data: { requested: ids.length, changed, failures },
    });
  },
  {
    endpoint: '/v1/emails',
    schema: bulkEmailActionSchema,
    audit: { action: 'email.bulk_delete', resourceType: 'email' },
  },
);
