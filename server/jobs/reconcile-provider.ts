import 'server-only';

import { cron } from 'inngest';

import { getReconciliationService } from '@/server/mail/services';

import { inngest } from './inngest';

/**
 * Provider reconciliation, every six hours (roadmap Phase 10).
 *
 * Six hours is a deliberate choice, not a default. Drift here is silent — an
 * alias someone deleted in the provider dashboard produces no error anywhere,
 * mail just stops arriving — so the interval is really "how long is it
 * acceptable to lose mail before anyone is told". A day is too long. A minute
 * would spend the provider's rate limit finding nothing, all day, every day.
 *
 * It never repairs. The sweep records findings and the Domains page shows a
 * banner; a human presses the button. See `ReconciliationService`.
 */
export const reconcileProvider = inngest.createFunction(
  {
    id: 'reconcile-provider',
    // One retry, unlike the delivery function's zero: a sweep that failed on a
    // transient provider hiccup is worth repeating, and repeating it is safe
    // because it writes findings and changes nothing.
    retries: 1,
    triggers: [cron('0 */6 * * *')],
  },
  async ({ step }) =>
    step.run('reconcile', () => getReconciliationService().run()),
);
