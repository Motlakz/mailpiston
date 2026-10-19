import { beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '@/server/core/errors';
import type { Email } from '@/server/core/types';
import {
  InMemoryEmailRepository,
  InMemoryEventRepository,
  InMemoryMailFilterRepository,
  InMemoryThreadRepository,
} from '@/server/test/in-memory-repositories';

import { SenderPolicyService, senderScopes } from './sender-policy-service';

let emails: InMemoryEmailRepository;
let events: InMemoryEventRepository;
let filters: InMemoryMailFilterRepository;
let senders: SenderPolicyService;

const NOW = new Date('2026-10-19T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  events = new InMemoryEventRepository();
  emails = new InMemoryEmailRepository(new InMemoryThreadRepository(), events);
  filters = new InMemoryMailFilterRepository();
  senders = new SenderPolicyService(emails, filters, events);
});

/** A received message, `daysAgo` old, with the verdict the classifier gave it. */
async function received(
  from: string,
  daysAgo: number,
  spamVerdict: Email['spamVerdict'] = 'suspicious',
): Promise<Email> {
  const email = await emails.create({
    threadId: null,
    addressId: null,
    providerMessageId: null,
    messageId: null,
    fingerprint: null,
    direction: 'inbound',
    status: 'received',
    from,
    to: ['hello@mine.test'],
    cc: [],
    subject: 'Grow your startup',
    text: 'Unsubscribe any time.',
    html: null,
    inReplyTo: null,
    references: [],
    rawStorageKey: null,
    receivedAt: null,
    sentAt: null,
    spamVerdict,
  });

  const aged = { ...email, createdAt: new Date(NOW.getTime() - daysAgo * DAY) };
  emails.rows.set(email.id, aged);
  return aged;
}

async function sentTo(address: string) {
  await emails.create({
    threadId: null,
    addressId: null,
    providerMessageId: null,
    messageId: null,
    fingerprint: null,
    direction: 'outbound',
    status: 'sent',
    from: 'hello@mine.test',
    to: [address],
    cc: [],
    subject: 'Re: hello',
    text: 'Thanks!',
    html: null,
    inReplyTo: null,
    references: [],
    rawStorageKey: null,
    receivedAt: null,
    sentAt: NOW,
  });
}

describe('blocking a persistent sender on arrival', () => {
  it('blocks a sender whose flagged mail sat unreviewed for more than three days', async () => {
    await received('Founder Battle <hi@founderbattle.com>', 4);

    const pattern = await senders.blockIfPersistent('hi@founderbattle.com', [], NOW);

    expect(pattern).toBe('hi@founderbattle.com');
    expect(filters.rows).toMatchObject([
      { kind: 'deny', pattern: 'hi@founderbattle.com', source: 'auto' },
    ]);
  });

  it('counts binned junk as unreviewed — binning is not forgiving', async () => {
    const email = await received('hi@founderbattle.com', 5, 'spam');
    emails.rows.set(email.id, { ...email, deletedAt: NOW });

    expect(await senders.blockIfPersistent('hi@founderbattle.com', [], NOW)).toBe(
      'hi@founderbattle.com',
    );
  });

  it('leaves a sender alone while the three days are still running', async () => {
    await received('hi@founderbattle.com', 2);

    expect(await senders.blockIfPersistent('hi@founderbattle.com', [], NOW)).toBeNull();
    expect(filters.rows).toHaveLength(0);
  });

  it('leaves a sender alone once their mail was reviewed as fine', async () => {
    await received('hi@founderbattle.com', 6, 'clean');

    expect(await senders.blockIfPersistent('hi@founderbattle.com', [], NOW)).toBeNull();
  });

  it('never blocks someone the operator released mail from', async () => {
    await received('pat@studio.test', 6);
    await received('pat@studio.test', 10, 'clean');
    await events.create({
      emailId: null,
      type: 'email.released',
      metadata: { by: 'operator', from: 'Pat <pat@studio.test>' },
    });

    expect(await senders.blockIfPersistent('pat@studio.test', [], NOW)).toBeNull();
  });

  it('never blocks someone the operator has written to', async () => {
    await received('pat@studio.test', 6);
    await sentTo('pat@studio.test');

    expect(await senders.blockIfPersistent('pat@studio.test', [], NOW)).toBeNull();
  });

  it('never blocks a trusted platform, however its mail scored', async () => {
    await received('Google <noreply-accounts@google.com>', 20);

    expect(
      await senders.blockIfPersistent('noreply-accounts@google.com', [], NOW),
    ).toBeNull();
  });

  it('never blocks an allow-listed sender', async () => {
    await received('news@expo-like.test', 20);

    expect(
      await senders.blockIfPersistent('news@expo-like.test', ['expo-like.test'], NOW),
    ).toBeNull();
  });

  it('blocks the whole domain when it rotates addresses, catching the next one', async () => {
    await received('anna@focusapps.app', 8);
    await received('ben@mail.focusapps.app', 5);

    const pattern = await senders.blockIfPersistent('carla@focusapps.app', [], NOW);

    expect(pattern).toBe('focusapps.app');
    expect(filters.rows[0].note).toMatch(/2 addresses/);
  });

  it('does not block a domain where somebody is vouched for', async () => {
    await received('anna@agency.test', 8);
    await received('ben@agency.test', 5);
    await sentTo('owner@agency.test');

    expect(await senders.blockIfPersistent('ben@agency.test', [], NOW)).toBe(
      'ben@agency.test',
    );
  });

  it('never blocks a shared mailbox provider as a whole', async () => {
    await received('spammer.one@gmail.com', 8);
    await received('spammer.two@gmail.com', 8);

    expect(await senders.blockIfPersistent('customer@gmail.com', [], NOW)).toBeNull();
    expect(await senders.blockIfPersistent('spammer.one@gmail.com', [], NOW)).toBe(
      'spammer.one@gmail.com',
    );
  });
});

describe('deciding about a sender from a message', () => {
  it('trusts a sender and releases the rest of their flagged mail', async () => {
    const first = await received('Expo <news@expo-ish.test>', 1);
    const second = await received('news@expo-ish.test', 2, 'spam');
    await filters.add({ kind: 'deny', pattern: 'news@expo-ish.test', note: null });

    const result = await senders.decideForEmail(first.id, 'trust');

    expect(result).toMatchObject({ pattern: 'news@expo-ish.test', moved: 2 });
    expect(await filters.lists()).toEqual({ allow: ['news@expo-ish.test'], deny: [] });
    expect(emails.rows.get(second.id)?.spamVerdict).toBe('clean');
    expect(events.rows.filter((event) => event.type === 'email.released')).toHaveLength(2);
  });

  it('blocks a whole domain and quarantines what it already sent', async () => {
    const pitch = await received('sam@pitchy.test', 1, 'clean');
    const other = await received('jo@news.pitchy.test', 1);

    const result = await senders.decideForEmail(pitch.id, 'block', 'domain');

    expect(result.pattern).toBe('pitchy.test');
    expect(emails.rows.get(other.id)?.spamVerdict).toBe('spam');
    expect(emails.rows.get(pitch.id)?.spamSignals[0].rule).toBe('sender_blocked');
  });

  it('refuses to block or trust a shared mailbox provider as a whole', async () => {
    const email = await received('someone@gmail.com', 1);

    await expect(senders.decideForEmail(email.id, 'block', 'domain')).rejects.toThrow(
      ValidationError,
    );
    await expect(senders.decideForEmail(email.id, 'trust', 'domain')).rejects.toThrow(
      ValidationError,
    );
  });

  it('collapses a bulk selection into one decision per sender', async () => {
    const a = await received('x@junk.test', 1);
    const b = await received('X <x@junk.test>', 1);
    const c = await received('y@junk.test', 1);

    const result = await senders.decideForEmails([a.id, b.id, c.id], 'block');

    expect(result.patterns.sort()).toEqual(['x@junk.test', 'y@junk.test']);
    expect(result.failures).toEqual([]);
  });
});

describe('senderScopes', () => {
  it('offers domain scope for a company and withholds it for shared providers', () => {
    expect(senderScopes('Dana <dana@mail.acme.co.uk>')).toEqual({
      address: 'dana@mail.acme.co.uk',
      domain: 'acme.co.uk',
      canTrustDomain: true,
      canBlockDomain: true,
    });

    expect(senderScopes('x@gmail.com')).toMatchObject({
      canTrustDomain: false,
      canBlockDomain: false,
    });
  });

  it('lets a trusted platform be trusted as a domain but not blocked as one', () => {
    expect(senderScopes('noreply-accounts@google.com')).toMatchObject({
      domain: 'google.com',
      canTrustDomain: true,
      canBlockDomain: false,
    });
  });
});
