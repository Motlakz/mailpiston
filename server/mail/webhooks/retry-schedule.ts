/**
 * The retry schedule (plan §15.1).
 *
 * Kept free of `server-only`, of configuration, and of any database import, so
 * the curve can be reasoned about and tested on its own. It is the only place
 * that decides *when*; Neon decides *what state a delivery is in*, and Inngest
 * only carries out the waiting.
 *
 *   attempt 1   immediately
 *   attempt 2   +30s
 *   attempt 3   +2m
 *   attempt 4   +10m
 *   attempt 5   +1h
 *   attempt 6   +6h
 *   attempt 7   +24h
 *
 * Seven attempts spread over roughly 31 hours. That is long enough to ride out
 * a receiver's overnight outage and short enough that a delivery does not sit
 * pending for a week pretending it might still succeed.
 */
export const RETRY_DELAYS_MS = [
  0,
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

/** ±15%. Enough to break up a thundering herd, not enough to blur the curve. */
const JITTER = 0.15;

/**
 * How long to wait before attempt number `attempt` (1-based), or `null` once
 * the schedule is exhausted.
 *
 * Jitter matters more than it looks. A receiver that falls over drops every
 * in-flight delivery at once, and an unjittered schedule marches all of them
 * back in lockstep — the retry storm arrives at the same instant as the last
 * one, which is precisely when the receiver is least able to take it.
 *
 * `random` is injectable so a test can pin the curve rather than assert on a
 * range.
 */
export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number | null {
  if (attempt < 1 || attempt > MAX_ATTEMPTS) return null;

  const base = RETRY_DELAYS_MS[attempt - 1];
  if (base === 0) return 0;

  const spread = 1 + (random() * 2 - 1) * JITTER;
  return Math.round(base * spread);
}

/** Whether a failure at this attempt number is the last one. */
export function isFinalAttempt(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS;
}
