import 'server-only';

import { env } from '@/server/core/config';
import { sha256Hex } from '@/server/core/crypto';
import { checkRateLimit } from '@/server/core/rate-limit';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface EgressBudget {
  reserve(input: {
    kind: 'message' | 'personal_forward';
    recipient?: string;
    /** Provider-billable recipients, not API calls. */
    units?: number;
  }): Promise<void>;
}

/** Reserves provider capacity before any billable send leaves MailPiston. */
export function egressBudgetFor(tenantId: string): EgressBudget {
  const actor = `provider:${tenantId}` as const;

  return {
    async reserve(input) {
      const units = input.units ?? 1;

      if (input.kind === 'personal_forward') {
        if (!input.recipient) {
          throw new Error('A personal forward needs a recipient for rate limiting');
        }

        await checkRateLimit(
          actor,
          `/egress/personal-target/${sha256Hex(input.recipient.toLowerCase())}`,
          {
            requests: env.PERSONAL_FORWARD_TARGET_HOURLY_LIMIT,
            windowMs: HOUR_MS,
            failOpen: false,
          },
          units,
        );
        await checkRateLimit(actor, '/egress/personal-forward', {
          requests: env.PERSONAL_FORWARD_DAILY_LIMIT,
          windowMs: DAY_MS,
          failOpen: false,
        }, units);
      }

      await checkRateLimit(actor, '/egress/all', {
        requests: env.OUTBOUND_DAILY_SEND_LIMIT,
        windowMs: DAY_MS,
        failOpen: false,
      }, units);
    },
  };
}
