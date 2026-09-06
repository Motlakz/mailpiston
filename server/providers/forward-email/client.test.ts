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

    await expect(client.verifyRecords('example.com')).resolves.toEqual([]);
  });

  it('returns the missing records a 400 lists instead of throwing', async () => {
    const message = [
      'Making changes to your DNS records takes time to propagate throughout the Internet. You may need to wait a few minutes and then try again.',
      ',Domain is missing required DNS TXT record of: forward-email-site-verification=Hg4jRxxnkN,',
      'Domain is missing required DNS MX records of:',
      ' * 0 mx1.forwardemail.net (0 = Priority)\n * 0 mx2.forwardemail.net (0 = Priority)',
    ].join('\n\n');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ statusCode: 400, error: 'Bad Request', message }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const issues = await client.verifyRecords('example.com');

    expect(issues).toHaveLength(3);
    expect(issues[1]).toBe(
      'Domain is missing required DNS TXT record of: forward-email-site-verification=Hg4jRxxnkN',
    );
    // The MX bullets stay attached to the heading they belong to.
    expect(issues[2]).toContain('mx1.forwardemail.net');
    expect(issues[2]).toContain('mx2.forwardemail.net');
  });

  it('still throws when the provider genuinely fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('boom', { status: 500 })),
    );

    await expect(client.verifyRecords('example.com')).rejects.toThrow(
      /returned 500/,
    );
  });
});
