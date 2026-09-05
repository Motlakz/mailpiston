import { describe, expect, it } from 'vitest';

import { createInboundFingerprint } from './fingerprint';

const base = {
  provider: 'forward-email',
  messageId: 'plain-001@mail.example.net',
  recipient: 'support@fixture-domain.test',
  addressId: 'addr_1',
};

describe('createInboundFingerprint', () => {
  it('is stable for the same delivery', () => {
    expect(createInboundFingerprint(base)).toBe(createInboundFingerprint(base));
  });

  it('ignores recipient casing', () => {
    expect(
      createInboundFingerprint({ ...base, recipient: 'Support@Fixture-Domain.TEST' }),
    ).toBe(createInboundFingerprint(base));
  });

  it('separates the same message delivered to two managed addresses', () => {
    // The reason addressId is in the key at all: one message fanned out to two
    // of our addresses must produce two rows, not one deduplicated into
    // silence.
    expect(
      createInboundFingerprint({
        ...base,
        recipient: 'billing@fixture-domain.test',
        addressId: 'addr_2',
      }),
    ).not.toBe(createInboundFingerprint(base));
  });

  it('tolerates a missing message id', () => {
    const key = createInboundFingerprint({ ...base, messageId: null });
    expect(key).toContain('forward-email');
    expect(key).toContain('addr_1');
  });

  it('prefers a provider id when both are present', () => {
    expect(
      createInboundFingerprint({ ...base, providerMessageId: 'fe_123' }),
    ).not.toBe(createInboundFingerprint(base));
  });
});
