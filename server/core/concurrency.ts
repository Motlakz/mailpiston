/**
 * Runs asynchronous work with a hard in-process concurrency ceiling.
 *
 * `Promise.all(items.map(...))` is a latent outage when `items` is tenant- or
 * user-controlled: a backlog turns into an equally large connection spike.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError('Concurrency limit must be a positive safe integer');
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}
