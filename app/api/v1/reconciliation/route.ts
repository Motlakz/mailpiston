import { NextResponse } from 'next/server';

import { withApi } from '@/server/core/http';
import { getReconciliationService } from '@/server/mail/services';
import { repositories } from '@/server/repositories';

/**
 * The latest sweep and everything it found (roadmap Phase 10).
 *
 * `ok` items are returned alongside the findings on purpose. "We checked 14
 * things and 13 were fine" and "we checked one thing" look identical if only
 * problems come back, and the difference between them is whether the sweep
 * actually ran.
 */
export const GET = withApi(
  async () => {
    const run = await repositories.reconciliation.latestRun();

    return NextResponse.json({
      data: run
        ? { run, items: await repositories.reconciliation.listItems(run.id) }
        : { run: null, items: [] },
    });
  },
  { endpoint: '/v1/reconciliation' },
);

/**
 * Runs a sweep now, rather than waiting up to six hours for the cron.
 *
 * It detects and records; it repairs nothing. Repair is a separate, explicit
 * action per domain.
 */
export const POST = withApi(
  async () => {
    const summary = await getReconciliationService().run();
    return NextResponse.json({ data: summary }, { status: 201 });
  },
  {
    endpoint: '/v1/reconciliation',
    audit: { action: 'reconciliation.run', resourceType: 'reconciliation' },
  },
);
