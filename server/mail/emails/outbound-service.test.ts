import { beforeEach, describe, expect, it } from 'vitest';
import { SendLimitExceededError } from '@/server/core/tenancy/limits';

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

  it('sends as a plain address, so a ported caller keeps the string it has', async () => {
    const email = await outbound.send({
      from: `support@${DOMAIN}`,
      to: ['customer@example.com'],
      subject: 'Scheduled maintenance',
      text: 'We are upgrading on Friday.',
    });

    expect(email.addressId).toBe(sendableId);
    expect(provider.sentMessages[0].from).toBe(`support@${DOMAIN}`);
  });

  it('carries a display name into the header but not into the row', async () => {
    const email = await outbound.send({
      from: `Speak Diary Support <SUPPORT@${DOMAIN.toUpperCase()}>`,
      to: ['customer@example.com'],
      subject: 'Scheduled maintenance',
      text: 'We are upgrading on Friday.',
    });

    expect(provider.sentMessages[0].from).toBe(
      `"Speak Diary Support" <support@${DOMAIN}>`,
    );
    // The row is what a reply addresses and a thread groups by, so it holds
    // the address alone — a display name there would fork the sender in two.
    expect(email.from).toBe(`support@${DOMAIN}`);
  });

  it('refuses a from that is not one of our addresses', async () => {
    await expect(
      outbound.send({
        from: 'support@someone-elses-domain.test',
        to: ['customer@example.com'],
        subject: 'Nope',
        text: 'No alias authorises this.',
      }),
    ).rejects.toThrow(/not one of your addresses/);

    expect(provider.sentMessages).toHaveLength(0);
    expect(emails.rows.size).toBe(0);
  });

  it('refuses an inbound-only address named by email, with the same reason as by id', async () => {
    await expect(
      outbound.send({
        from: `notices@${DOMAIN}`,
        to: ['customer@example.com'],
        subject: 'Nope',
        text: 'This address has no alias to authorise a From.',
      }),
    ).rejects.toThrow(/inbound-only/);
  });

  it('refuses a from that is not an address at all', async () => {
    await expect(
      outbound.send({
        from: 'Speak Diary Support',
        to: ['customer@example.com'],
        subject: 'Nope',
        text: 'body',
      }),
    ).rejects.toThrow(/not an email address/);
  });

  it('refuses a send that names neither a from nor an address', async () => {
    await expect(
      outbound.send({
        to: ['customer@example.com'],
        subject: 'Nope',
        text: 'body',
      }),
    ).rejects.toThrow(/needs a `from` address/);
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

  it('takes a display name on a reply, since the address agrees', async () => {
    const captured = await inbound.capture(delivery());

    await outbound.reply(captured.emailId!, {
      from: `Speak Diary Support <support@${DOMAIN}>`,
      text: 'On it.',
    });

    expect(provider.sentMessages[0].from).toBe(
      `"Speak Diary Support" <support@${DOMAIN}>`,
    );
  });

  it('refuses a reply that tries to go out as a different address', async () => {
    const captured = await inbound.capture(delivery());

    await expect(
      outbound.reply(captured.emailId!, {
        from: `notices@${DOMAIN}`,
        text: 'On it.',
      }),
    ).rejects.toThrow(/would start a new conversation/);

    expect(provider.sentMessages).toHaveLength(0);
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

/**
 * The send gate.
 *
 * Worth testing at this level rather than trusting the wiring: the limit is
 * only meaningful if it refuses *before* a row exists. A gate that rejects
 * after writing leaves a queued message that will never go out, which is worse
 * than no gate — the operator sees mail they believe was sent.
 */
describe('monthly send limit', () => {
  it('refuses a send once the allowance is spent, and writes nothing', async () => {
    const limited = new OutboundService(
      emails,
      addresses,
      events,
      threads,
      provider,
      {
        async assert() {
          throw new SendLimitExceededError(1000, 1000);
        },
      },
    );

    const before = (await emails.list({ limit: 100 })).items.length;

    await expect(
      limited.send({
        addressId: sendableId,
        to: ['someone@example.test'],
        subject: 'Over the line',
        text: 'This should never leave.',
      }),
    ).rejects.toBeInstanceOf(SendLimitExceededError);

    const after = (await emails.list({ limit: 100 })).items.length;
    expect(after).toBe(before);
  });

  it('allows a send while allowance remains', async () => {
    const allowed = new OutboundService(
      emails,
      addresses,
      events,
      threads,
      provider,
      { async assert() {} },
    );

    const sent = await allowed.send({
      addressId: sendableId,
      to: ['someone@example.test'],
      subject: 'Within the line',
      text: 'This should go.',
    });

    expect(sent.direction).toBe('outbound');
  });

  it('reserves the provider-wide egress budget before writing a queued row', async () => {
    const guarded = new OutboundService(
      emails,
      addresses,
      events,
      threads,
      provider,
      { async assert() {} },
      {
        async reserve() {
          throw new Error('daily provider-send safety limit reached');
        },
      },
    );
    const before = (await emails.list({ limit: 100 })).items.length;

    await expect(
      guarded.send({
        addressId: sendableId,
        to: ['someone@example.test'],
        subject: 'Over provider budget',
        text: 'This should not be queued.',
      }),
    ).rejects.toThrow(/provider-send safety limit/);

    expect((await emails.list({ limit: 100 })).items.length).toBe(before);
  });

  it('counts only outbound mail in the window', async () => {
    // Inbound is counted for usage reporting but never gated — refusing mail
    // somebody sent you is the one failure a mail system does not get to have.
    const start = new Date(Date.now() - 60_000);

    await new OutboundService(emails, addresses, events, threads, provider, {
      async assert() {},
    }).send({
      addressId: sendableId,
      to: ['someone@example.test'],
      subject: 'Counted',
      text: 'One.',
    });

    expect(await emails.countOutboundSince(start)).toBeGreaterThan(0);
    expect(await emails.countOutboundSince(new Date(Date.now() + 60_000))).toBe(0);
  });
});
