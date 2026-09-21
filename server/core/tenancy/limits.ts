import 'server-only';

import { eq } from 'drizzle-orm';

import { APIError } from '@/server/core/errors';
import { db } from '@/server/db/client';
import { tenants } from '@/server/db/schema';
import type { EmailRepository } from '@/server/repositories/types';

/**
 * A send ceiling, enforced from the first day.
 *
 * Domains are not gated — that is the whole pitch, and metering them would
 * price the thing that costs nothing. Messages are gated, because they are the
 * thing that does: a runaway reply loop or a compromised key can spend a
 * provider allowance in an afternoon, and the first anyone would know is the
 * bill.
 *
 * Deliberately generous rather than absent. A limit that exists from day one
 * can be raised for a customer who needs it; one introduced later is a change
 * of terms for every account that never had it.
 */
export class SendLimitExceededError extends APIError {
  constructor(
    public readonly used: number,
    public readonly limit: number,
  ) {
    super(
      `This workspace has sent ${used} of its ${limit} messages for the month. Sending resumes next month, or the limit can be raised.`,
      429,
      'SEND_LIMIT_EXCEEDED',
    );
    this.name = 'SendLimitExceededError';
  }
}

export interface SendUsage {
  used: number;
  limit: number;
  remaining: number;
  /** When the window rolls over, so a caller can say *when*, not just "no". */
  resetsAt: Date;
}

/**
 * The start of the current calendar month, in UTC.
 *
 * UTC rather than local for the same reason the date formatters are: this runs
 * on a server whose timezone is not the customer's, and a window that moves
 * with the renderer is one nobody can reconcile against their own records.
 */
function windowStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function windowEnd(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export async function sendUsageFor(
  tenantId: string,
  emails: EmailRepository,
): Promise<SendUsage> {
  const [row] = await db
    .select({ limit: tenants.monthlySendLimit })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const limit = row?.limit ?? 0;
  const used = await emails.countOutboundSince(windowStart());

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: windowEnd(),
  };
}

/**
 * The gate itself.
 *
 * Checked before the message row is written, not after: a send that is going
 * to be refused should leave nothing behind, and a queued row for a message
 * that never goes out is the kind of debris that makes a mailbox untrustworthy.
 */
export async function assertWithinSendLimit(
  tenantId: string,
  emails: EmailRepository,
): Promise<void> {
  const usage = await sendUsageFor(tenantId, emails);

  if (usage.remaining <= 0) {
    throw new SendLimitExceededError(usage.used, usage.limit);
  }
}
