import { describe, expect, it } from 'vitest';

import {
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  isFinalAttempt,
  retryDelayMs,
} from './retry-schedule';

/** `Math.random` pinned to the midpoint, so jitter contributes nothing. */
const noJitter = () => 0.5;

describe('retryDelayMs', () => {
  it('runs the first attempt immediately', () => {
    expect(retryDelayMs(1, noJitter)).toBe(0);
  });

  it('follows the documented curve', () => {
    // 30s, 2m, 10m, 1h, 6h, 24h — pinned, because the curve is a product
    // decision and a silent change to it is invisible until an outage.
    expect(RETRY_DELAYS_MS.slice(1).map((_, index) => retryDelayMs(index + 2, noJitter)))
      .toEqual([30_000, 120_000, 600_000, 3_600_000, 21_600_000, 86_400_000]);
  });

  it('stops once the schedule is exhausted', () => {
    expect(retryDelayMs(MAX_ATTEMPTS, noJitter)).not.toBeNull();
    expect(retryDelayMs(MAX_ATTEMPTS + 1, noJitter)).toBeNull();
  });

  it('rejects an attempt number below one', () => {
    expect(retryDelayMs(0, noJitter)).toBeNull();
    expect(retryDelayMs(-1, noJitter)).toBeNull();
  });

  it('spreads retries either side of the base delay', () => {
    // A receiver that falls over drops every in-flight delivery at once, and an
    // unjittered schedule marches all of them back in lockstep — arriving
    // together exactly when the receiver is least able to take it.
    const earliest = retryDelayMs(2, () => 0);
    const latest = retryDelayMs(2, () => 1);

    expect(earliest).toBeLessThan(RETRY_DELAYS_MS[1]);
    expect(latest).toBeGreaterThan(RETRY_DELAYS_MS[1]);
    expect(earliest).toBeGreaterThan(RETRY_DELAYS_MS[1] * 0.8);
    expect(latest).toBeLessThan(RETRY_DELAYS_MS[1] * 1.2);
  });

  it('never jitters the immediate attempt', () => {
    // Delaying the first attempt by "a bit of jitter" would put the ingest path
    // to sleep for no reason.
    expect(retryDelayMs(1, () => 0)).toBe(0);
    expect(retryDelayMs(1, () => 1)).toBe(0);
  });
});

describe('isFinalAttempt', () => {
  it('marks the last scheduled attempt as final', () => {
    expect(isFinalAttempt(MAX_ATTEMPTS - 1)).toBe(false);
    expect(isFinalAttempt(MAX_ATTEMPTS)).toBe(true);
    expect(isFinalAttempt(MAX_ATTEMPTS + 1)).toBe(true);
  });
});
