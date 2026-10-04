import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, ApiRequestError } from './api-client';

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('accepts a successful mutation with no response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(apiRequest<void>('/api/v1/api-keys/key_1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('returns data from a successful create response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { id: 'domain_1' } }, { status: 201 })));

    await expect(apiRequest<{ id: string }>('/api/v1/domains', { method: 'POST' })).resolves.toEqual({ id: 'domain_1' });
  });

  it('still reports an API failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'CONFLICT', message: 'Already exists' } }, { status: 409 })));

    await expect(apiRequest('/api/v1/domains', { method: 'POST' })).rejects.toMatchObject<Partial<ApiRequestError>>({
      message: 'Already exists',
      code: 'CONFLICT',
      status: 409,
    });
  });

  it('reports an unexpected non-JSON response as an API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>error</html>', { status: 502 })));

    await expect(apiRequest('/api/v1/domains', { method: 'POST' })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 502,
    });
  });
});
