import 'server-only';

import { getWebhookService } from '@/server/mail/services';

import { inngest, webhookDeliveryFailed } from './inngest';

/**
 * The retry engine (plan §15.3).
 *
 * It does exactly two things: wait, then ask the delivery service to try again.
 * Every decision about *whether* to send, and every write recording what
 * happened, stays in Neon behind the atomic claim — which is what makes it safe
 * for this event to arrive twice, or for Inngest to re-run the function.
 *
 * `retries: 0` is deliberate and easy to get wrong. Inngest's own retries would
 * re-run this function and produce an *extra* delivery attempt that the
 * schedule never authorised, on a curve nobody chose. The delivery's own retry
 * schedule is the only one, and a failed attempt already enqueues the next
 * event before this function returns.
 *
 * The chain therefore ends by itself: the last scheduled attempt fails,
 * `retryDelayMs` returns null, the row becomes `failed`, and no further event
 * is sent.
 */
export const retryWebhookDelivery = inngest.createFunction(
  {
    id: 'retry-webhook-delivery',
    retries: 0,
    triggers: [webhookDeliveryFailed],
  },
  async ({ event, step }) => {
    // Timing from the event, state from the database. Sleeping first and
    // reading afterwards is what makes a delivery that succeeded in the
    // meantime — through a manual retry, say — cost nothing: the claim will
    // simply refuse it.
    await step.sleep('wait-before-retry', event.data.delayMs);

    return step.run('deliver-webhook', () =>
      getWebhookService().attempt(event.data.deliveryId),
    );
  },
);
