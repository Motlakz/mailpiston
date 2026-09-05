import { describe, expect, it } from 'vitest';

import { computeSignature, verifySignature } from './verifier';

const KEY = 'test-webhook-key';
const BODY = JSON.stringify({ messageId: '<a@b>', recipients: ['x@y.test'] });

describe('Forward Email signature verification', () => {
  it('accepts a signature over the exact raw body', () => {
    expect(verifySignature(BODY, computeSignature(BODY, KEY), KEY)).toBe(true);
  });

  it('rejects a single flipped byte in the body', () => {
    const signature = computeSignature(BODY, KEY);
    const tampered = BODY.replace('x@y.test', 'z@y.test');

    expect(tampered).not.toBe(BODY);
    expect(verifySignature(tampered, signature, KEY)).toBe(false);
  });

  it('rejects a signature made with a different key', () => {
    expect(verifySignature(BODY, computeSignature(BODY, 'other-key'), KEY)).toBe(
      false,
    );
  });

  it('rejects a missing signature rather than treating it as absent-therefore-fine', () => {
    expect(verifySignature(BODY, null, KEY)).toBe(false);
    expect(verifySignature(BODY, '', KEY)).toBe(false);
  });

  it('does not throw on a signature of the wrong length', () => {
    // timingSafeEqual throws on mismatched buffers; the length must not be an
    // oracle, and it must not be a 500 either.
    expect(() => verifySignature(BODY, 'deadbeef', KEY)).not.toThrow();
    expect(verifySignature(BODY, 'deadbeef', KEY)).toBe(false);
  });

  it('is case-insensitive on the hex digest', () => {
    const signature = computeSignature(BODY, KEY).toUpperCase();
    expect(verifySignature(BODY, signature, KEY)).toBe(true);
  });

  it('fails once the body has been re-serialised', () => {
    // The whole reason the wrapper reads request.text() before parsing:
    // JSON.stringify(JSON.parse(body)) is not byte-identical in general.
    const signature = computeSignature(BODY, KEY);
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);

    expect(verifySignature(reserialised, signature, KEY)).toBe(false);
  });
});
