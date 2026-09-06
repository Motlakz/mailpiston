import { beforeEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@/server/core/crypto';
import { OutboundService } from '@/server/mail/emails/outbound-service';
import { InboundService } from '@/server/mail/inbound/inbound-service';
import { DefaultThreadResolver } from '@/server/mail/threads/thread-resolver';
import { MockMailProvider } from '@/server/providers/mock/provider';
import type { NormalizedInboundEmail } from '@/server/providers/types';
import {
  InMemoryAddressRepository,
  InMemoryDomainRepository,
  InMemoryEmailRepository,
  InMemoryEndpointRepository,
  InMemoryEventRepository,
  InMemoryReplyRelayRepository,
  InMemoryStorage,
  InMemoryThreadRepository,
} from '@/server/test/in-memory-repositories';

import { ForwardingService } from './forwarding-service';
import { RelayService, stripQuotedReply } from './relay-service';

const DOMAIN = 'fixture-domain.test';
const RELAY_DOMAIN = 'reply.mailpiston.test';
const PERSONAL = 'operator@personal.example';
const CUSTOMER = 'customer@example.com';

let domains: InMemoryDomainRepository;
let addresses: InMemoryAddressRepository;
let emails: InMemoryEmailRepository;
let events: InMemoryEventRepository;
let threads: InMemoryThreadRepository;
let endpoints: InMemoryEndpointRepository;
let relays: InMemoryReplyRelayRepository;
let provider: MockMailProvider;
let inbound: InboundService;
let outbound: OutboundService;
let recipientId: string;

beforeEach(async () => {
  domains = new InMemoryDomainRepository();
  addresses = new InMemoryAddressRepository(domains);
  threads = new InMemoryThreadRepository();
  emails = new InMemoryEmailRepository(threads);
  events = new InMemoryEventRepository();
  endpoints = new InMemoryEndpointRepository();
  relays = new InMemoryReplyRelayRepository();
  provider = new MockMailProvider();

  outbound = new OutboundService(emails, addresses, events, threads, provider);

  const forwarding = new ForwardingService(
    endpoints,
    relays,
    events,
    provider,
    30,
  );

  const relay = new RelayService(relays, endpoints, emails, events, outbound);

  inbound = new InboundService(
    emails,
    addresses,
    events,
    new DefaultThreadResolver(threads),
    new InMemoryStorage(),
    { storeRawMime: false },
    { relay, forwarding },
  );

  const domain = await domains.create({
    name: DOMAIN,
    providerDomainId: DOMAIN,
    status: 'verified',
    dnsRecords: [],
  });

  const address = await addresses.create({
    domainId: domain.id,
    localPart: 'support',
    providerAliasId: 'alias_1',
    canSend: true,
    enabled: true,
  });

  const endpoint = await endpoints.create({
    name: 'My inbox',
    type: 'email',
    enabled: true,
  });

  const recipient = await endpoints.addRecipient(endpoint.id, PERSONAL);
  await endpoints.markRecipientVerified(recipient.id);
  recipientId = recipient.id;

  await endpoints.bindToAddress(address.id, endpoint.id);
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
    envelopeSender: CUSTOMER,
    from: `"Ada Lovelace" <${CUSTOMER}>`,
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

/** The relay address minted for the notification the operator just received. */
function relayAddressFromNotification(): string {
  const notification = provider.sentMessages.at(-1)!;
  return notification.replyTo!;
}

function relayReply(
  overrides: Partial<NormalizedInboundEmail> = {},
): NormalizedInboundEmail {
  const relayAddress = relayAddressFromNotification();

  return delivery({
    recipient: relayAddress,
    envelopeRecipients: [relayAddress],
    envelopeSender: PERSONAL,
    from: `"Operator" <${PERSONAL}>`,
    to: [relayAddress],
    messageId: '<personal-1@personal.example>',
    providerMessageId: 'fe_personal_1',
    subject: 'Re: Help please',
    text: 'Turning it off and on again.',
    ...overrides,
  });
}

describe('personal forwarding', () => {
  it('delivers a notification to the verified inbox without exposing the customer chain', async () => {
    await inbound.capture(delivery());

    expect(provider.sentMessages).toHaveLength(1);
    const notification = provider.sentMessages[0];

    expect(notification.to).toEqual([PERSONAL]);
    // From is the managed address; the customer's name survives as a label.
    expect(notification.from).toContain(`<support@${DOMAIN}>`);
    expect(notification.from).toContain('Ada Lovelace via');
    expect(notification.replyTo).toMatch(
      new RegExp(`^reply\\+.+@${RELAY_DOMAIN}$`),
    );
    // Loop prevention, so an autoresponder does not answer this forever.
    expect(notification.headers?.['Auto-Submitted']).toBe('auto-generated');

    expect(events.rows.map((row) => row.type)).toContain(
      'personal_forward.delivered',
    );
  });

  it('stores only the hash of the relay token', async () => {
    await inbound.capture(delivery());

    const token = relayAddressFromNotification().split('+')[1].split('@')[0];
    const [relay] = [...relays.rows.values()];

    expect(relay.tokenHash).toBe(sha256Hex(token));
    expect(relay.tokenHash).not.toContain(token);
  });

  it('never forwards to an unverified recipient', async () => {
    const endpoint = await endpoints.create({
      name: 'Unproven',
      type: 'email',
      enabled: true,
    });
    await endpoints.addRecipient(endpoint.id, 'stranger@example.net');

    const [address] = await addresses.list();
    await endpoints.bindToAddress(address.id, endpoint.id);

    await inbound.capture(delivery());

    const notified = provider.sentMessages.flatMap((message) => message.to);
    expect(notified).toContain(PERSONAL);
    expect(notified).not.toContain('stranger@example.net');
  });

  it('keeps the message even when forwarding fails outright', async () => {
    const failing = new ForwardingService(
      endpoints,
      relays,
      events,
      {
        ...provider,
        send: async () => {
          throw new Error('mailbox unreachable');
        },
      } as unknown as MockMailProvider,
      30,
    );

    const service = new InboundService(
      emails,
      addresses,
      events,
      new DefaultThreadResolver(threads),
      new InMemoryStorage(),
      { storeRawMime: false },
      { forwarding: failing },
    );

    const result = await service.capture(delivery());

    // Ingress must stay durable: a provider retry would deduplicate, and the
    // operator would end up with no mail at all.
    expect(result.status).toBe('captured');
    expect(events.rows.map((row) => row.type)).toContain(
      'personal_forward.failed',
    );
  });
});

describe('relayed replies', () => {
  it('sends the reply to the customer as the managed address, in the same thread', async () => {
    const captured = await inbound.capture(delivery());
    const parent = await emails.findById(captured.emailId!);

    const result = await inbound.capture(relayReply());
    expect(result.status).toBe('relayed');

    const sent = provider.sentMessages.at(-1)!;
    // The customer keeps their display name; only the address has to match.
    expect(sent.to.join(' ')).toContain(CUSTOMER);
    expect(sent.from).toBe(`support@${DOMAIN}`);

    // Nothing personal in what the customer receives.
    const serialised = JSON.stringify(sent);
    expect(serialised).not.toContain(PERSONAL);
    expect(serialised).not.toContain('personal-1@personal.example');

    const relayed = await emails.findById(result.emailId!);
    expect(relayed!.threadId).toBe(parent!.threadId);
    expect(relayed!.direction).toBe('outbound');
    expect(events.rows.map((row) => row.type)).toContain('relay.reply_sent');
  });

  it('sends nothing when the sender is not the verified recipient', async () => {
    await inbound.capture(delivery());
    const before = provider.sentMessages.length;

    const result = await inbound.capture(
      relayReply({ envelopeSender: 'impostor@example.net' }),
    );

    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('sender_mismatch');
    expect(provider.sentMessages).toHaveLength(before);
  });

  it('sends nothing once the relay is revoked', async () => {
    await inbound.capture(delivery());
    const before = provider.sentMessages.length;

    const [relay] = [...relays.rows.values()];
    await relays.revoke(relay.id);

    const result = await inbound.capture(relayReply());

    expect(result.reason).toBe('revoked_token');
    expect(provider.sentMessages).toHaveLength(before);
  });

  it('sends nothing for an unknown token, and records the attempt by hash', async () => {
    await inbound.capture(delivery());
    const before = provider.sentMessages.length;

    const result = await inbound.capture(
      relayReply({
        recipient: `reply+not-a-real-token@${RELAY_DOMAIN}`,
        to: [`reply+not-a-real-token@${RELAY_DOMAIN}`],
      }),
    );

    expect(result.reason).toBe('unknown_token');
    expect(provider.sentMessages).toHaveLength(before);

    const rejection = events.rows.at(-1)!;
    expect(rejection.type).toBe('relay.reply_rejected');
    // The token itself is never written to the log.
    expect(JSON.stringify(rejection.metadata)).not.toContain('not-a-real-token');
  });

  it('does not relay an out-of-office autoresponse', async () => {
    await inbound.capture(delivery());
    const before = provider.sentMessages.length;

    const result = await inbound.capture(
      relayReply({ headers: { 'Auto-Submitted': 'auto-replied' } }),
    );

    expect(result.reason).toBe('auto_response');
    expect(provider.sentMessages).toHaveLength(before);
  });

  it('does not store the relay message as inbound customer mail', async () => {
    await inbound.capture(delivery());
    const inboundRows = [...emails.rows.values()].filter(
      (row) => row.direction === 'inbound',
    );

    await inbound.capture(relayReply());

    const after = [...emails.rows.values()].filter(
      (row) => row.direction === 'inbound',
    );
    expect(after).toHaveLength(inboundRows.length);
  });

  it('recipient verification requires the code that was mailed', async () => {
    const wrong = await endpoints.verifyRecipientWithToken(
      recipientId,
      sha256Hex('guessed'),
      new Date(),
    );

    expect(wrong).toBeNull();
  });
});

describe('stripQuotedReply', () => {
  it('drops the quoted original and the signature', () => {
    const body = [
      'Turning it off and on again.',
      '',
      'On Fri, 4 Sep 2026, Ada Lovelace wrote:',
      '> It broke.',
      '',
      '-- ',
      'Sent from my personal address',
    ].join('\n');

    expect(stripQuotedReply(body)).toBe('Turning it off and on again.');
  });

  it('keeps the body when there is nothing mechanical to strip', () => {
    expect(stripQuotedReply('Just this.')).toBe('Just this.');
  });
});
