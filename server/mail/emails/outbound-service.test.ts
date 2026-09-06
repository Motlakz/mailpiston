import { beforeEach, describe, expect, it } from 'vitest';

import { DefaultThreadResolver } from '@/server/mail/threads/thread-resolver';
import { MockMailProvider } from '@/server/providers/mock/provider';
import type { NormalizedInboundEmail } from '@/server/providers/types';
import {
  InMemoryAddressRepository,
  InMemoryDomainRepository,
  InMemoryEmailRepository,
  InMemoryEventRepository,
  InMemoryStorage,
  InMemoryThreadRepository,
} from '@/server/test/in-memory-repositories';

import { InboundService } from '../inbound/inbound-service';
import { OutboundService } from './outbound-service';

const DOMAIN = 'fixture-domain.test';

let domains: InMemoryDomainRepository;
let addresses: InMemoryAddressRepository;
let emails: InMemoryEmailRepository;
let events: InMemoryEventRepository;
let threads: InMemoryThreadRepository;
let provider: MockMailProvider;
let outbound: OutboundService;
let inbound: InboundService;
let sendableId: string;
let inboundOnlyId: string;

beforeEach(async () => {
  domains = new InMemoryDomainRepository();
  addresses = new InMemoryAddressRepository(domains);
  threads = new InMemoryThreadRepository();
  emails = new InMemoryEmailRepository(threads);
  events = new InMemoryEventRepository();
  provider = new MockMailProvider();

  outbound = new OutboundService(emails, addresses, events, threads, provider);
  inbound = new InboundService(
    emails,
    addresses,
    events,
    new DefaultThreadResolver(threads),
    new InMemoryStorage(),
    { storeRawMime: false },
  );

  const domain = await domains.create({
    name: DOMAIN,
    providerDomainId: DOMAIN,
    status: 'verified',
    dnsRecords: [],
  });

  sendableId = (
    await addresses.create({
      domainId: domain.id,
      localPart: 'support',
      providerAliasId: 'alias_1',
      canSend: true,
      enabled: true,
    })
  ).id;

  inboundOnlyId = (
    await addresses.create({
      domainId: domain.id,
      localPart: 'notices',
      providerAliasId: null,
      canSend: false,
      enabled: true,
    })
  ).id;
});

function delivery(
  overrides: Partial<NormalizedInboundEmail> = {},
): NormalizedInboundEmail {
  return {
    provider: 'mock',
    providerMessageId: 'fe_1',
    messageId: '<customer-1@example.com>',
    recipient: `support@${DOMAIN}`,
    envelopeRecipients: [`support@${DOMAIN}`],
    envelopeSender: 'customer@example.com',
    from: 'customer@example.com',
    to: [`support@${DOMAIN}`],
    cc: [],
    subject: 'Help please',
    text: 'It broke.',
    html: null,
    inReplyTo: null,
    references: [],
    receivedAt: new Date('2026-09-06T10:00:00Z'),
    attachments: [],
    raw: null,
    headers: {},
    ...overrides,
  };
}

describe('OutboundService.send', () => {
  it('persists the message, sends it, and records both events', async () => {
    const email = await outbound.send({
      addressId: sendableId,
      to: ['customer@example.com'],
      subject: 'Scheduled maintenance',
      text: 'We are upgrading on Friday.',
    });

    expect(email.direction).toBe('outbound');
    expect(email.status).toBe('sent');
    expect(email.from).toBe(`support@${DOMAIN}`);
    expect(email.messageId).toBeTruthy();
    expect(email.sentAt).not.toBeNull();
    expect(provider.sentMessages).toHaveLength(1);

    expect(events.rows.map((row) => row.type)).toEqual([
      'email.queued',
      'email.sent',
    ]);
  });

  it('refuses an inbound-only address rather than letting the provider refuse it', async () => {
    await expect(
      outbound.send({
        addressId: inboundOnlyId,
        to: ['customer@example.com'],
        subject: 'Nope',
        text: 'This address has no alias to authorise a From.',
      }),
    ).rejects.toThrow(/inbound-only/);

    expect(provider.sentMessages).toHaveLength(0);
    expect(emails.rows.size).toBe(0);
  });

  it('keeps the row and marks it failed when the provider rejects the send', async () => {
    const failing = new OutboundService(emails, addresses, events, threads, {
      ...provider,
      send: async () => {
        throw new Error('provider is down');
      },
    } as unknown as MockMailProvider);

    await expect(
      failing.send({
        addressId: sendableId,
        to: ['customer@example.com'],
        subject: 'Will not go',
        text: 'body',
      }),
    ).rejects.toThrow('provider is down');

    // The attempt has to stay visible: a discarded send is the one failure
    // mode with no trace at all.
    const [row] = [...emails.rows.values()];
    expect(row.status).toBe('failed');
    expect(events.rows.map((event) => event.type)).toContain('email.failed');
  });
});

describe('OutboundService.reply', () => {
  it('threads the reply for the recipient as well as for us', async () => {
    const captured = await inbound.capture(delivery());
    const parent = await emails.findById(captured.emailId!);

    const reply = await outbound.reply(parent!.id, { text: 'On it.' });

    expect(reply.threadId).toBe(parent!.threadId);
    expect(reply.to).toEqual(['customer@example.com']);
    expect(reply.subject).toBe('Re: Help please');
    expect(reply.inReplyTo).toBe('<customer-1@example.com>');
    expect(reply.references).toContain('<customer-1@example.com>');

    const [sent] = provider.sentMessages;
    expect(sent.from).toBe(`support@${DOMAIN}`);
  });

  it('does not stack Re: on a subject that already has one', async () => {
    const captured = await inbound.capture(
      delivery({ subject: 'Re: Help please' }),
    );

    const reply = await outbound.reply(captured.emailId!, { text: 'Still on it.' });
    expect(reply.subject).toBe('Re: Help please');
  });

  it('keeps a customer follow-up in the same thread as our reply', async () => {
    const captured = await inbound.capture(delivery());
    const reply = await outbound.reply(captured.emailId!, { text: 'On it.' });

    const followUp = await inbound.capture(
      delivery({
        messageId: '<customer-2@example.com>',
        providerMessageId: 'fe_2',
        inReplyTo: reply.messageId,
        subject: 'Re: Help please',
      }),
    );

    const stored = await emails.findById(followUp.emailId!);
    expect(stored!.threadId).toBe(reply.threadId);
    expect(threads.rows.size).toBe(1);
  });
});

describe('OutboundService.recordDeliveryEvent', () => {
  it('flips a sent message to hard_bounced and records the event', async () => {
    const email = await outbound.send({
      addressId: sendableId,
      to: ['dead@example.com'],
      subject: 'Hello',
      text: 'body',
    });

    await outbound.recordDeliveryEvent({
      type: 'hard_bounced',
      providerMessageId: email.providerMessageId,
      messageId: null,
      recipient: 'dead@example.com',
      detail: { code: 550 },
    });

    expect((await emails.findById(email.id))!.status).toBe('hard_bounced');
    expect(events.rows.map((row) => row.type)).toContain('email.hard_bounced');
  });

  it('records an event for a message it cannot match rather than dropping it', async () => {
    const { emailId } = await outbound.recordDeliveryEvent({
      type: 'delivered',
      providerMessageId: 'fe_unknown',
      messageId: null,
      recipient: 'someone@example.com',
      detail: {},
    });

    expect(emailId).toBeNull();

    const event = events.rows.at(-1)!;
    expect(event.emailId).toBeNull();
    expect(event.metadata.unmatched).toBe(true);
  });
});
