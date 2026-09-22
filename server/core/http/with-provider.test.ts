import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A refused delivery has to say so.
 *
 * `formatErrorResponse` logs only unexpected errors, and a rejected signature
 * is an expected one — so a wrong or missing webhook key produced a 401 and
 * nothing else: no log line, no stored mail, and no event, because an
 * unauthenticated request has no tenant to record an event against. Mail
 * stopped arriving and the only evidence was an empty inbox.
 */
const verifyInboundWebhook = vi.fn();

vi.mock('@/server/providers/registry', () => ({
  mailProviderRegistry: { active: () => ({ verifyInboundWebhook }) },
}));

vi.mock('@/server/core/rate-limit', () => ({
  checkRateLimit: async () => ({ limit: 100, remaining: 99, resetAt: 0 }),
  rateLimitHeaders: () => ({}),
}));

const { withProvider } = await import('./with-provider');

const route = withProvider(async () => NextResponse.json({ received: true }), {
  provider: 'forward-email',
  endpoint: '/api/providers/forward-email/inbound',
});

function delivery(headers: Record<string, string> = {}) {
  return new Request('https://mailpiston.test/api/providers/forward-email/inbound', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ recipients: ['support@example.test'] }),
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  verifyInboundWebhook.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('provider ingress', () => {
  it('logs a refusal, and says a signature header was present', async () => {
    verifyInboundWebhook.mockResolvedValue(false);

    const response = await route(
      delivery({ 'x-webhook-signature': 'deadbeef' }),
    );

    expect(response.status).toBe(401);
    expect(warn).toHaveBeenCalledTimes(1);

    const [, detail] = warn.mock.calls[0];
    expect(detail).toMatchObject({
      reason: 'signature',
      signatureHeaderPresent: true,
    });
  });

  it('distinguishes a delivery that carried no signature at all', async () => {
    // The two causes need different fixes: an unsigned delivery means the
    // provider was never told to sign, a signed one that fails means it signs
    // with a key we do not hold.
    verifyInboundWebhook.mockResolvedValue(false);

    const response = await route(delivery());

    expect(response.status).toBe(401);
    expect(warn.mock.calls[0][1]).toMatchObject({
      signatureHeaderPresent: false,
    });
  });

  it('never writes the signature or the body into the log', async () => {
    verifyInboundWebhook.mockResolvedValue(false);

    await route(delivery({ 'x-webhook-signature': 'deadbeef' }));

    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).not.toContain('deadbeef');
    expect(logged).not.toContain('support@example.test');
  });

  it('stays quiet when the delivery verifies', async () => {
    verifyInboundWebhook.mockResolvedValue(true);

    const response = await route(
      delivery({ 'x-webhook-signature': 'deadbeef' }),
    );

    expect(response.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
  });
});
