import { serve } from 'inngest/next';

import { env } from '@/server/core/config';
import { inngest } from '@/server/jobs/inngest';
import { retryWebhookDelivery } from '@/server/jobs/retry-webhook-delivery';

/**
 * Where Inngest invokes our functions.
 *
 * Not behind `withApi`: the caller is Inngest, not an operator or an API key,
 * and it authenticates with its own request signature. Putting our own auth in
 * front of it would reject every invocation.
 *
 * The signing key is passed explicitly rather than left to Inngest's own
 * environment lookup, so a production deployment missing it fails at boot with
 * the rest of the configuration instead of accepting unsigned invocations here.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [retryWebhookDelivery],
  ...(env.INNGEST_SIGNING_KEY ? { signingKey: env.INNGEST_SIGNING_KEY } : {}),
});
