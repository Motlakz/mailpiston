import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import {
  bulkEmailActionSchema,
  type BulkEmailActionInput,
} from '@/server/core/validation';
import { servicesFor } from '@/server/mail/services';

export const POST = withApi<BulkEmailActionInput>(
  async ({ body, tenantId }) => {
    const ids = [...new Set(body.ids)];

    // Sender decisions are per sender, not per message: twelve rows from one
    // spammer are one block, so they go through the service as a set.
    if (body.action === 'trust' || body.action === 'block') {
      const result = await servicesFor(tenantId)
        .senders()
        .decideForEmails(ids, body.action);

      return NextResponse.json({
        data: {
          requested: ids.length,
          changed: ids.length - result.failures.length,
          senders: result.patterns.length,
          moved: result.moved,
          failures: result.failures,
        },
      });
    }

    const mailbox = servicesFor(tenantId).mailbox();
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
    audit: { action: 'email.bulk_action', resourceType: 'email' },
  },
);
