import 'server-only';

import type { RetryScheduler } from '@/server/mail/webhooks/retry-scheduler';

import { inngest, webhookDeliveryFailed } from './inngest';

/**
 * The production `RetryScheduler`: it sends one event and knows nothing else.
 *
 * Kept this thin on purpose. The delivery service already wrote the failure to
 * Neon before calling this, so if the send throws, the delivery is a `pending`
 * row that a manual retry can pick up — visible and repairable. The error is
 * re-raised rather than swallowed so the caller records it; silently losing a
 * schedule would leave a delivery that looks queued forever.
 */
export const inngestRetryScheduler: RetryScheduler = {
  async scheduleRetry({ deliveryId, attempt, delayMs }) {
    // Built through the event definition rather than as a loose object literal,
    // so the name and the data shape come from the same place the function's
    // trigger does. A typo in either is a compile error, not a retry that never
    // arrives.
    const { name, data } = webhookDeliveryFailed.create({
      deliveryId,
      attempt,
      delayMs,
    });

    await inngest.send({ name, data });
  },
};
