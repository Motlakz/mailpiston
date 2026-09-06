import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForwardEmailClient } from './client';

const client = new ForwardEmailClient({
  apiToken: 'test-token',
  baseUrl: 'https://api.forwardemail.test',
  timeoutMs: 1_000,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ForwardEmailClient verification', () => {
  it('accepts the provider text acknowledgement', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Domain verification has been requested.', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
      ),
    );

    await expect(client.verifyRecords('example.com')).resolves.toBeUndefined();
  });
});
