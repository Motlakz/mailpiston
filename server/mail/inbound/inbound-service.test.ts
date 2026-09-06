import { beforeEach, describe, expect, it } from 'vitest';

import type { NormalizedInboundEmail } from '@/server/providers/types';
import {
  InMemoryAddressRepository,
  InMemoryDomainRepository,
  InMemoryEmailRepository,
  InMemoryEventRepository,
  InMemoryStorage,
} from '@/server/test/in-memory-repositories';

import { InboundService } from './inbound-service';

let domains: InMemoryDomainRepository;
let addresses: InMemoryAddressRepository;
let emails: InMemoryEmailRepository;
let events: InMemoryEventRepository;
let storage: InMemoryStorage;
let inbound: InboundService;

const DOMAIN = 'fixture-domain.test';

beforeEach(async () => {
  domains = new InMemoryDomainRepository();
  addresses = new InMemoryAddressRepository(domains);
  emails = new InMemoryEmailRepository();
  events = new InMemoryEventRepository();
  storage = new InMemoryStorage();
  inbound = new InboundService(emails, addresses, events, storage, {
    storeRawMime: false,
  });

  const domain = await domains.create({
    name: DOMAIN,
    providerDomainId: DOMAIN,
    status: 'verified',
    dnsRecords: [],
  });

  await addresses.create({
    domainId: domain.id,
    localPart: 'support',
    providerAliasId: 'alias_1',
    canSend: true,
    enabled: true,
  });
});

function delivery(
  overrides: Partial<NormalizedInboundEmail> = {},
): NormalizedInboundEmail {
  return {
    provider: 'forward-email',
    providerMessageId: 'fe_1',
    messageId: '<abc@example.com>',
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

describe('InboundService', () => {
  it('captures a delivery as one durable record plus one event', async () => {
    const result = await inbound.capture(delivery());

    expect(result.status).toBe('captured');
    expect(emails.rows.size).toBe(1);

    const [email] = [...emails.rows.values()];
    expect(email.direction).toBe('inbound');
    expect(email.status).toBe('received');
    expect(email.subject).toBe('Help please');
    expect(emails.events).toHaveLength(1);
    expect(emails.events[0].type).toBe('email.received');
  });

  it('does not require object storage for a message with no stored bytes', async () => {
    const withoutStorage = new InboundService(
      emails,
      addresses,
      events,
      () => {
        throw new Error('No object storage configured');
      },
      { storeRawMime: false },
    );

    const result = await withoutStorage.capture(delivery());

    expect(result.status).toBe('captured');
    expect(emails.rows.size).toBe(1);
  });

  it('still requires object storage when a message has an attachment', async () => {
    const withoutStorage = new InboundService(
      emails,
      addresses,
      events,
      () => {
        throw new Error('No object storage configured');
      },
      { storeRawMime: false },
    );

    await expect(
      withoutStorage.capture(
        delivery({
          attachments: [
            {
              filename: 'invoice.pdf',
              contentType: 'application/pdf',
              sizeBytes: 1,
              content: Buffer.from('x').toString('base64'),
              contentId: null,
            },
          ],
        }),
      ),
    ).rejects.toThrow('No object storage configured');
  });

  it('treats a replayed provider POST as a duplicate, not a second row', async () => {
    const payload = delivery();

    const first = await inbound.capture(payload);
    const second = await inbound.capture(payload);

    expect(first.status).toBe('captured');
    expect(second.status).toBe('duplicate');
    expect(second.emailId).toBeNull();
    expect(emails.rows.size).toBe(1);
  });

  it('keeps both copies when one message is fanned out to two addresses', async () => {
    const domain = await domains.findByName(DOMAIN);
    await addresses.create({
      domainId: domain!.id,
      localPart: 'billing',
      providerAliasId: 'alias_2',
      canSend: true,
      enabled: true,
    });

    // Same Message-ID, two envelope recipients, two provider deliveries. The
    // address is in the fingerprint precisely so these do not collapse.
    await inbound.capture(delivery({ recipient: `support@${DOMAIN}` }));
    await inbound.capture(delivery({ recipient: `billing@${DOMAIN}` }));

    expect(emails.rows.size).toBe(2);
  });

  it('does not deduplicate distinct messages that carry no id at all', async () => {
    const anonymous = { providerMessageId: null, messageId: null };

    await inbound.capture(delivery({ ...anonymous, subject: 'First' }));
    await inbound.capture(delivery({ ...anonymous, subject: 'Second' }));

    // Without the content fallback in the fingerprint, both of these would key
    // to `forward-email:::support@…:addr_1` and the second would be discarded.
    expect(emails.rows.size).toBe(2);
  });

  it('still deduplicates a replay of an id-less message', async () => {
    const payload = delivery({ providerMessageId: null, messageId: null });

    await inbound.capture(payload);
    const second = await inbound.capture(payload);

    expect(second.status).toBe('duplicate');
    expect(emails.rows.size).toBe(1);
  });

  it('records mail for an unknown local part as rejected and stores nothing', async () => {
    const result = await inbound.capture(
      delivery({ recipient: `nobody@${DOMAIN}` }),
    );

    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('unknown_recipient');
    expect(emails.rows.size).toBe(0);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].type).toBe('email.rejected');
    expect(events.rows[0].metadata.recipient).toBe(`nobody@${DOMAIN}`);
  });

  it('rejects mail for a disabled address rather than silently storing it', async () => {
    const [address] = [...addresses.rows.values()];
    await addresses.update(address.id, { enabled: false });

    const result = await inbound.capture(delivery());

    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('address_disabled');
    expect(emails.rows.size).toBe(0);
  });

  it('puts attachment bytes in storage and only metadata in the database', async () => {
    const content = Buffer.from('%PDF-1.4 fake invoice').toString('base64');

    await inbound.capture(
      delivery({
        attachments: [
          {
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            sizeBytes: 999,
            content,
            contentId: null,
          },
        ],
      }),
    );

    const [attachment] = [...emails.attachments.values()];
    expect(attachment.filename).toBe('invoice.pdf');
    expect(attachment.storageKey).toMatch(/^attachments\/em_/);

    // The provider's declared size disagreed with the bytes on purpose. What
    // we record has to match what a download will actually produce.
    expect(attachment.sizeBytes).toBe(21);
    expect(storage.objects.get(attachment.storageKey)?.toString()).toBe(
      '%PDF-1.4 fake invoice',
    );
  });

  it('stores raw MIME only when the flag is on', async () => {
    const raw = 'From: customer@example.com\r\n\r\nIt broke.';

    await inbound.capture(delivery({ raw }));
    expect([...storage.objects.keys()]).toHaveLength(0);

    const withRaw = new InboundService(emails, addresses, events, storage, {
      storeRawMime: true,
    });
    await withRaw.capture(delivery({ messageId: '<second@example.com>', raw }));

    const key = [...storage.objects.keys()].find((k) => k.startsWith('raw/'));
    expect(key).toBeDefined();
    expect(storage.objects.get(key!)?.toString()).toBe(raw);
  });

  it('routes on the envelope recipient, not the To: header', async () => {
    // A BCC'd message names nobody relevant in To:. Routing on headers would
    // drop it; routing on the envelope is the whole point.
    const result = await inbound.capture(
      delivery({
        recipient: `support@${DOMAIN}`,
        to: ['someone-else@elsewhere.test'],
      }),
    );

    expect(result.status).toBe('captured');
  });
});
