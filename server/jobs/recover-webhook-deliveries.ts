import 'server-only';

import { cron } from 'inngest';

import { mapWithConcurrency } from '@/server/core/concurrency';
import { allTenantIds } from '@/server/core/tenancy/resolve';
import { servicesFor } from '@/server/mail/services';

import { inngest } from './inngest';

/**
 * Safety net for the gap between recording a retry and scheduling it.
 *
 * The normal Inngest event remains the fast path. This sweep only sees work
 * whose `next_attempt_at` elapsed or whose owner died holding an expired lease,
 * and the delivery repository's atomic claim elects exactly one path.
 */
export const recoverWebhookDeliveries = inngest.createFunction(
  {
    id: 'recover-webhook-deliveries',
    retries: 1,
    concurrency: 1,
    triggers: [cron('*/2 * * * *')],
  },
  async ({ step }) => {
    const tenants = await step.run('list-tenants', allTenantIds);

    return mapWithConcurrency(tenants, 3, (tenantId) =>
      step
        .run(`recover-${tenantId}`, () =>
          servicesFor(tenantId).webhooks().recoverDue(),
        )
        .catch((error: unknown) => {
          console.error('Webhook recovery failed for tenant', tenantId, error);
          return null;
        }),
    );
  },
);
