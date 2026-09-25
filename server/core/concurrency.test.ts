import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('never starts more work than the configured ceiling', async () => {
    let active = 0;
    let peak = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return item * 2;
    });

    expect(peak).toBe(2);
    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('rejects invalid limits instead of silently running unbounded', async () => {
    await expect(mapWithConcurrency([1], 0, async (item) => item)).rejects.toThrow(
      /positive safe integer/,
    );
  });
});
