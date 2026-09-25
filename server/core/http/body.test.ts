import { describe, expect, it } from 'vitest';

import { readBodyText, readJsonBody } from './body';

describe('bounded request bodies', () => {
  it('refuses a declared oversized body without reading it', async () => {
    const request = new Request('https://mailpiston.test/api', {
      method: 'POST',
      headers: { 'content-length': '1000' },
      body: '{}',
    });

    await expect(readBodyText(request, 10)).rejects.toMatchObject({
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('counts stream bytes when Content-Length is absent', async () => {
    const request = new Request('https://mailpiston.test/api', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('12345'));
          controller.enqueue(new TextEncoder().encode('67890'));
          controller.close();
        },
      }),
      // Node requires this for a streaming request body, but the DOM type does
      // not expose it. Request still receives the exact stream under test.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await expect(readBodyText(request, 8)).rejects.toMatchObject({
      statusCode: 413,
    });
  });

  it('measures UTF-8 bytes rather than JavaScript characters', async () => {
    const body = '📨📨'; // four UTF-16 code units, eight UTF-8 bytes
    const request = new Request('https://mailpiston.test/api', {
      method: 'POST',
      body,
    });

    await expect(readBodyText(request, 7)).rejects.toMatchObject({
      statusCode: 413,
    });
  });

  it('parses valid JSON inside the limit and keeps parse errors generic', async () => {
    await expect(
      readJsonBody(
        new Request('https://mailpiston.test/api', {
          method: 'POST',
          body: JSON.stringify({ ok: true }),
        }),
        100,
      ),
    ).resolves.toEqual({ ok: true });

    await expect(
      readJsonBody(
        new Request('https://mailpiston.test/api', {
          method: 'POST',
          body: '{secret payload',
        }),
        100,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
