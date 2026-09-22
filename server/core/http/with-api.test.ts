import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The audit trail, and the route context Next actually passes.
 *
 * Next hands every route handler a context object, dynamic segment or not, but
 * sets `params` to `undefined` when there is nothing to fill it with. Reading
 * `params.id` off the result of awaiting that threw a TypeError inside
 * `recordAudit` — which swallows its own errors, so the mutation returned 201
 * and the audit entry silently never existed.
 *
 * It only ever hit routes with no `[id]` in their path, which is why the audit
 * log looked healthy: `email.delete` and `api_key.revoke` are addressed by id
 * and were writing entries normally the whole time.
 */
const record = vi.fn();

vi.mock('@/server/repositories', () => ({
  repositoriesFor: () => ({ audit: { record } }),
}));

vi.mock('@/server/core/auth/session', () => ({
  getOperatorSession: async () => ({
    userId: 'user_test',
    tenantId: 'ten_test',
  }),
}));

vi.mock('@/server/core/auth/api-key', () => ({
  resolveApiKey: async () => {
    throw new Error('no API key in these tests');
  },
}));

vi.mock('@/server/core/rate-limit', () => ({
  checkRateLimit: async () => ({ limit: 100, remaining: 99, resetAt: 0 }),
  rateLimitHeaders: () => ({}),
}));

const { withApi } = await import('./with-api');

const route = withApi(
  async () => NextResponse.json({ data: { ok: true } }, { status: 201 }),
  {
    endpoint: '/v1/endpoints',
    audit: { action: 'endpoint.create', resourceType: 'endpoint' },
  },
);

const request = () =>
  new Request('https://mailpiston.test/v1/endpoints', { method: 'POST' });

beforeEach(() => {
  record.mockReset();
  record.mockResolvedValue({ id: 'aud_test' });
});

describe('withApi audit', () => {
  it('records on a static route, where Next passes params: undefined', async () => {
    const response = await route(request(), { params: undefined });

    expect(response.status).toBe(201);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      action: 'endpoint.create',
      resourceId: null,
    });
  });

  it('records on a dynamic route, carrying the id through', async () => {
    const response = await route(request(), {
      params: Promise.resolve({ id: 'ep_123' }),
    });

    expect(response.status).toBe(201);
    expect(record.mock.calls[0][0]).toMatchObject({ resourceId: 'ep_123' });
  });

  it('records when no context is passed at all', async () => {
    // Not a shape Next produces today, but the parameter is optional and a
    // direct caller in a test or a script is entitled to omit it.
    const response = await route(request());

    expect(response.status).toBe(201);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('still returns the mutation when the audit write fails', async () => {
    // The mutation already happened. Failing the request would have the caller
    // retry it, turning a logging outage into duplicate endpoints.
    record.mockRejectedValue(new Error('audit table is on fire'));

    const response = await route(request(), { params: undefined });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { ok: true } });
  });
});
