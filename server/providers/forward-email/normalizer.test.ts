import { describe, expect, it } from 'vitest';

import bccOnly from './__fixtures__/bcc-only.json';
import html from './__fixtures__/html.json';
import plainText from './__fixtures__/plain-text.json';
import reply from './__fixtures__/reply.json';
import withAttachment from './__fixtures__/with-attachment.json';
import { ForwardEmailNormalizer } from './normalizer';

const normalizer = new ForwardEmailNormalizer();

describe('ForwardEmailNormalizer.normalizeInbound', () => {
  it('normalizes a plain-text message and lower-cases addresses', async () => {
    const result = await normalizer.normalizeInbound(plainText);

    expect(result.provider).toBe('forward-email');
    expect(result.messageId).toBe('plain-001@mail.example.net');
    expect(result.recipient).toBe('support@fixture-domain.test');
    // The From: header arrives mixed-case; routing and dedupe compare on it.
    expect(result.from).toBe('rhian@example.net');
    expect(result.to).toEqual(['support@fixture-domain.test']);
    expect(result.subject).toBe('Order 4821 has not arrived');
    expect(result.html).toBeNull();
    expect(result.envelopeSender).toBe('rhian@example.net');
  });

  it('keeps HTML and cc separate from text', async () => {
    const result = await normalizer.normalizeInbound(html);

    expect(result.html).toContain('<a href=');
    expect(result.text).toContain('the portal');
    expect(result.cc).toEqual(['finance@example.net']);
  });

  it('splits attachments into metadata and base64 content', async () => {
    const result = await normalizer.normalizeInbound(withAttachment);

    expect(result.attachments).toHaveLength(1);

    const [attachment] = result.attachments;
    expect(attachment.filename).toBe('contract.pdf');
    expect(attachment.contentType).toBe('application/pdf');
    expect(attachment.sizeBytes).toBe(11);
    expect(Buffer.from(attachment.content, 'base64').toString()).toBe('Hello world');
    // Angle brackets are stripped so a cid compares cleanly against a header.
    expect(attachment.contentId).toBe('att-1@example.net');
  });

  it('parses threading headers into bare ids', async () => {
    const result = await normalizer.normalizeInbound(reply);

    expect(result.inReplyTo).toBe('plain-001@mail.example.net');
    expect(result.references).toEqual([
      'root-000@mail.example.net',
      'plain-001@mail.example.net',
    ]);
  });

  it('routes a BCC-only delivery off the envelope, not the To: header', async () => {
    const result = await normalizer.normalizeInbound(bccOnly);

    // This is the case that breaks a header-based normalizer: the managed
    // address appears nowhere in To:.
    expect(result.to).toEqual(['someone-else@example.net']);
    expect(result.recipient).toBe('support@fixture-domain.test');
    expect(result.envelopeRecipients).toContain('support@fixture-domain.test');
  });

  it('puts the delivery-causing recipient first', async () => {
    const result = await normalizer.normalizeInbound({
      ...plainText,
      recipients: ['other@fixture-domain.test', 'support@fixture-domain.test'],
      session: { ...plainText.session, recipient: 'support@fixture-domain.test' },
    });

    expect(result.recipient).toBe('support@fixture-domain.test');
    expect(result.envelopeRecipients).toEqual([
      'support@fixture-domain.test',
      'other@fixture-domain.test',
    ]);
  });

  it('refuses a payload with no envelope recipient', async () => {
    await expect(
      normalizer.normalizeInbound({ ...plainText, recipients: [], session: {} }),
    ).rejects.toThrow(/no envelope recipient/i);
  });
});

describe('ForwardEmailNormalizer.normalizeDeliveryEvent', () => {
  it('classifies a hard bounce', async () => {
    const event = await normalizer.normalizeDeliveryEvent({
      messageId: '<plain-001@mail.example.net>',
      bounce: { address: 'Nobody@Example.NET', is_hard: true, category: 'blocked' },
      date: '2026-09-05T10:00:00.000Z',
    });

    expect(event.type).toBe('hard_bounced');
    expect(event.recipient).toBe('nobody@example.net');
    expect(event.messageId).toBe('plain-001@mail.example.net');
  });

  it('classifies a soft bounce', async () => {
    const event = await normalizer.normalizeDeliveryEvent({
      bounce: { address: 'busy@example.net', is_hard: false, category: 'defer' },
    });

    expect(event.type).toBe('soft_bounced');
  });

  it('falls back to failed for an unrecognised category', async () => {
    const event = await normalizer.normalizeDeliveryEvent({ bounce: {} });
    expect(event.type).toBe('failed');
  });
});
