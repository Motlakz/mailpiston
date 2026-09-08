import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isMailpistonEvent } from './payload';
import {
  MAILPISTON_HEADERS,
  signPayload,
  verifyWebhook,
} from './signing';

const SECRET = 'endpoint-signing-secret';
const BODY = JSON.stringify({ version: '1', id: 'evt_1' });

async function delivery(
  overrides: {
    body?: string;
    timestamp?: string;
    signature?: string;
  } = {},
): Promise<Request> {
  const body = overrides.body ?? BODY;
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));

  return new Request('https://app.example/hook', {
    method: 'POST',
    headers: {
      [MAILPISTON_HEADERS.timestamp]: timestamp,
      [MAILPISTON_HEADERS.signature]:
        overrides.signature ?? (await signPayload(timestamp, body, SECRET)),
    },
    body,
  });
}

describe('signPayload', () => {
  it('signs timestamp + "." + body', async () => {
    // Pinned against an independent implementation. The scheme is documented
    // and third parties will reimplement it, so it cannot quietly change shape.
    const expected = createHmac('sha256', SECRET)
      .update('1788541200.hello')
      .digest('hex');

    expect(await signPayload('1788541200', 'hello', SECRET)).toBe(
      `sha256=${expected}`,
    );
  });

  it('produces a different signature for the same body at a different time', async () => {
    // What makes the replay window enforceable: a signature over the body alone
    // would stay valid forever, so a captured delivery could be replayed at any
    // point in the future.
    const a = await signPayload('1788541200', BODY, SECRET);
    const b = await signPayload('1788541260', BODY, SECRET);

    expect(a).not.toBe(b);
  });
});

describe('verifyWebhook', () => {
  it('accepts a genuine delivery and returns the parsed body', async () => {
    const payload = await verifyWebhook<{ id: string }>(await delivery(), SECRET);
    expect(payload.id).toBe('evt_1');
  });

  it('rejects a wrong secret', async () => {
    await expect(verifyWebhook(await delivery(), 'other-secret')).rejects.toThrow(
      /Signature does not match/,
    );
  });

  it('rejects a body that was altered after signing', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signPayload(timestamp, BODY, SECRET);

    const tampered = await delivery({
      body: JSON.stringify({ version: '1', id: 'evt_2' }),
      timestamp,
      signature,
    });

    await expect(verifyWebhook(tampered, SECRET)).rejects.toThrow(
      /Signature does not match/,
    );
  });

  it('rejects a stale timestamp', async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    await expect(verifyWebhook(await delivery({ timestamp: stale }), SECRET)).rejects.toThrow(
      /replay window/,
    );
  });

  it('rejects a timestamp from the future', async () => {
    // Otherwise a far-future stamp would keep a captured delivery replayable
    // for as long as that stamp is ahead of the clock.
    const ahead = String(Math.floor(Date.now() / 1000) + 3600);
    await expect(verifyWebhook(await delivery({ timestamp: ahead }), SECRET)).rejects.toThrow(
      /replay window/,
    );
  });

  it('rejects a delivery with no signature headers', async () => {
    const bare = new Request('https://app.example/hook', {
      method: 'POST',
      body: BODY,
    });

    await expect(verifyWebhook(bare, SECRET)).rejects.toThrow(/Missing MailPiston/);
  });

  it('rejects a malformed timestamp', async () => {
    await expect(
      verifyWebhook(await delivery({ timestamp: 'yesterday' }), SECRET),
    ).rejects.toThrow(/Malformed timestamp/);
  });
});

describe('isMailpistonEvent', () => {
  it('accepts a v1 event', () => {
    expect(
      isMailpistonEvent({
        version: '1',
        id: 'evt_1',
        type: 'email.received',
        createdAt: new Date().toISOString(),
        data: { id: 'em_1' },
      }),
    ).toBe(true);
  });

  it('tolerates fields it has never seen', () => {
    // A versioned contract is allowed to grow. A guard that rejected unknown
    // fields would turn an additive change into an outage at every receiver.
    expect(
      isMailpistonEvent({
        version: '1',
        id: 'evt_1',
        type: 'email.received',
        createdAt: new Date().toISOString(),
        data: { id: 'em_1', somethingNew: true },
        alsoNew: 'hello',
      }),
    ).toBe(true);
  });

  it.each<[string, unknown]>([
    ['null', null],
    [
      'a future major version',
      { version: '2', id: 'evt_1', type: 'email.received', createdAt: '', data: { id: 'em_1' } },
    ],
    [
      'an unknown type',
      { version: '1', id: 'evt_1', type: 'email.exploded', createdAt: '', data: { id: 'em_1' } },
    ],
    [
      'a missing payload',
      { version: '1', id: 'evt_1', type: 'email.received', createdAt: '' },
    ],
  ])('rejects %s', (_label, value) => {
    expect(isMailpistonEvent(value)).toBe(false);
  });
});
