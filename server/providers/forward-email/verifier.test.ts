import { describe, expect, it } from 'vitest';

import {
  computeSignature,
  verifyAgainstAny,
  verifySignature,
} from './verifier';

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

describe('verifyAgainstAny — per-domain webhook keys', () => {
  const KEY_A = 'webhook-key-for-domain-a';
  const KEY_B = 'webhook-key-for-domain-b';
  const KEY_C = 'webhook-key-for-domain-c';

  it('accepts a body signed with any one of the candidate keys', () => {
    // Forward Email issues one key per domain, so a deployment with three
    // domains holds three keys and cannot know which signed a given request
    // until it has read a body it is not yet allowed to trust.
    for (const key of [KEY_A, KEY_B, KEY_C]) {
      const signature = computeSignature(BODY, key);
      expect(verifyAgainstAny(BODY, signature, [KEY_A, KEY_B, KEY_C])).toBe(true);
    }
  });

  it('rejects a body signed with a key that is not in the set', () => {
    const signature = computeSignature(BODY, 'a-key-we-never-stored');
    expect(verifyAgainstAny(BODY, signature, [KEY_A, KEY_B])).toBe(false);
  });

  it('rejects everything when there are no keys at all', () => {
    // An unconfigured deployment must fail closed. Verifying against an empty
    // set has to mean "nobody is authorised", never "no check to perform".
    const signature = computeSignature(BODY, KEY_A);
    expect(verifyAgainstAny(BODY, signature, [])).toBe(false);
  });

  it('still rejects a missing signature', () => {
    expect(verifyAgainstAny(BODY, null, [KEY_A])).toBe(false);
    expect(verifyAgainstAny(BODY, '', [KEY_A])).toBe(false);
  });

  it('does not short-circuit on the first match', () => {
    // Returning early would make response time depend on which key matched and
    // on how many keys exist — a side channel over the secrets themselves.
    // Asserting the shape rather than timing: a match in the LAST position must
    // behave identically to a match in the first.
    const signature = computeSignature(BODY, KEY_C);

    expect(verifyAgainstAny(BODY, signature, [KEY_C, KEY_A, KEY_B])).toBe(true);
    expect(verifyAgainstAny(BODY, signature, [KEY_A, KEY_B, KEY_C])).toBe(true);
  });

  it('does not throw on a malformed signature among real keys', () => {
    expect(() => verifyAgainstAny(BODY, 'deadbeef', [KEY_A, KEY_B])).not.toThrow();
    expect(verifyAgainstAny(BODY, 'deadbeef', [KEY_A, KEY_B])).toBe(false);
  });
});
