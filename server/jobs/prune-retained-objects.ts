import 'server-only';

import { cron } from 'inngest';

import { allTenantIds } from '@/server/core/tenancy/resolve';
import { servicesFor } from '@/server/mail/services';

import { inngest } from './inngest';

/**
 * Retention sweep, nightly (roadmap Phase 11).
 *
 * Daily rather than hourly because nothing here is urgent: the cost of holding
 * an object one more day is a fraction of a cent, and the cost of deleting one
 * too eagerly is a message an operator can no longer read. 03:00 UTC keeps it
 * away from the working hours of most of the world.
 *
 * The sweep is resumable and batched, so a backlog drains over several nights
 * rather than in one pass that might time out partway through a delete it
 * cannot then record.
 */
export const pruneRetainedObjects = inngest.createFunction(
  { id: 'prune-retained-objects', retries: 1, triggers: [cron('0 3 * * *')] },
  async ({ step }) => {
    const tenants = await step.run('list-tenants', allTenantIds);

    // Retention is per tenant because the policy is: one workspace's window
    // must never decide when another's bytes are deleted.
    return Promise.all(
      tenants.map((tenantId) =>
        step
          .run(`prune-${tenantId}`, () => servicesFor(tenantId).retention().prune())
          .catch((error: unknown) => {
            console.error('Retention prune failed for tenant', tenantId, error);
            return null;
          }),
      ),
    );
  },
);
