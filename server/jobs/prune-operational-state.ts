import 'server-only';

import { cron } from 'inngest';

import { pool } from '@/server/db/client';

import { inngest } from './inngest';

/**
 * Keeps attacker-influenced operational keys from growing without bound.
 * Daily rate-limit windows need two days; idempotency keys stay seven days so
 * delayed client/provider retries remain safely blocked.
 */
export const pruneOperationalState = inngest.createFunction(
  {
    id: 'prune-operational-state',
    retries: 1,
    concurrency: 1,
    triggers: [cron('30 3 * * *')],
  },
  async ({ step }) =>
    step.run('prune-expired-operational-keys', async () => {
      const [rateLimits, idempotency] = await Promise.all([
        pool.query(
          `DELETE FROM rate_limits WHERE updated_at < NOW() - INTERVAL '2 days'`,
        ),
        pool.query(
          `DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '7 days'`,
        ),
      ]);

      return {
        rateLimits: rateLimits.rowCount ?? 0,
        idempotency: idempotency.rowCount ?? 0,
      };
    }),
);
