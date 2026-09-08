/**
 * Who gets told that a delivery owes another attempt.
 *
 * An interface rather than a direct Inngest call, for two reasons. The delivery
 * service stays testable without a scheduler running, and the split the whole
 * retry design rests on stays visible in the types: **Neon owns the state,
 * Inngest owns the timing** (plan §15). Anything that tried to read retry state
 * back out of the scheduler would have to add a method here, and would look
 * wrong doing it.
 *
 * The database write always happens first. If the process dies between the two,
 * the delivery is a `pending` row that a manual retry can pick up — recoverable.
 * The other order loses the row and leaves a scheduled event pointing at
 * nothing.
 */
export interface RetryScheduler {
  scheduleRetry(input: {
    deliveryId: string;
    /** The attempt number this schedules, 1-based. */
    attempt: number;
    delayMs: number;
  }): Promise<void>;
}

/**
 * For tests and for any wiring that deliberately has no retry engine.
 *
 * Not a default. `WebhookService` takes its scheduler as a required option, so
 * a deployment cannot end up silently never retrying because somebody forgot an
 * argument — the omission has to be written down.
 */
export const noRetryScheduler: RetryScheduler = {
  async scheduleRetry() {},
};
