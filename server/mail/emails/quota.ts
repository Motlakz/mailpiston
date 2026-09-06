import 'server-only';

import { mailProviderRegistry } from '@/server/providers/registry';
import type { OutboundQuota } from '@/server/providers/types';

/**
 * The provider's send accounting, cached for a minute.
 *
 * Cached because it is rendered on a page an operator refreshes freely, and an
 * uncached read would spend a provider API call per refresh to tell them the
 * same number. A minute is short enough that the figure is never misleading
 * and long enough that the dashboard is not a load generator.
 *
 * A failure returns null rather than throwing: the send quota is context, and
 * a page that will not render because a status endpoint is down is worse than
 * one that says it could not check.
 */
const TTL_MS = 60_000;

let cached: { at: number; quota: OutboundQuota } | null = null;

export async function getOutboundQuota(): Promise<OutboundQuota | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.quota;

  try {
    const quota = await mailProviderRegistry.active().outboundQuota();
    cached = { at: Date.now(), quota };
    return quota;
  } catch (error) {
    console.error('Outbound quota check failed', error);
    return cached?.quota ?? null;
  }
}
