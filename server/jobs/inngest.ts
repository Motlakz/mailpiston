import 'server-only';

import { Inngest, eventType } from 'inngest';
import { z } from 'zod';

import { env } from '@/server/core/config';

/**
 * The Inngest client and the events it carries (plan §15).
 *
 * One rule governs everything in `server/jobs/`:
 *
 *   > Inngest controls the timing. Neon controls the state.
 *
 * Every event here carries identifiers and a delay, and nothing else. A payload
 * travelling inside an event would be a second copy of state that could
 * disagree with the row — and by the time a retry runs, possibly a day later,
 * the row is the only version anyone should trust.
 *
 * The event key comes from `config.ts` rather than from Inngest's own
 * environment lookup, so a missing one fails at boot with the rest of the
 * configuration instead of at the first retry.
 */
export const webhookDeliveryFailed = eventType('webhook/delivery.failed', {
  schema: z.object({
    deliveryId: z.string().min(1),
    /** The attempt this schedules, 1-based. Advisory: the row is the truth. */
    attempt: z.number().int().positive(),
    delayMs: z.number().int().nonnegative(),
  }),
});

export const inngest = new Inngest({
  id: 'mailpiston',
  ...(env.INNGEST_EVENT_KEY ? { eventKey: env.INNGEST_EVENT_KEY } : {}),
});
