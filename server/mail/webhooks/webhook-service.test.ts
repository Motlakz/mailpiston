import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptSecret } from '@/server/core/crypto';
import type { AddressWithDomain, Email, MailEvent } from '@/server/core/types';
import {
  InMemoryAddressRepository,
  InMemoryDeliveryRepository,
  InMemoryDomainRepository,
  InMemoryEmailRepository,
  InMemoryEndpointRepository,
  InMemoryEventRepository,
  InMemoryThreadRepository,
} from '@/server/test/in-memory-repositories';
import { MAILPISTON_HEADERS, verifyWebhook } from '@/sdk/src/signing';
import type { MailpistonWebhookEvent } from '@/sdk/src/payload';

import { WebhookService } from './webhook-service';

const DOMAIN = 'fixture-domain.test';
const SECRET = 'a-signing-secret-for-tests';
/**
 * A literal public address rather than a hostname: the SSRF guard resolves
 * whatever it is given, and a test suite should not depend on DNS.
 */
const URL_PUBLIC = 'https://93.184.216.34/hook';

let domains: InMemoryDomainRepository;
let addresses: InMemoryAddressRepository;
let threads: InMemoryThreadRepository;
let emails: InMemoryEmailRepository;
let events: InMemoryEventRepository;
let endpoints: InMemoryEndpointRepository;
let deliveries: InMemoryDeliveryRepository;

let address: AddressWithDomain;
let email: Email;
let event: MailEvent;
let endpointId: string;

/** Records every request so a test can assert on headers and body. */
function recordingFetch(
  responder: (request: { url: string; init: RequestInit }) => Response,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function serviceWith(fetchImpl: typeof fetch): WebhookService {
  return new WebhookService(
    endpoints,
    deliveries,
    emails,
    events,
    { timeoutMs: 500 },
    fetchImpl,
  );
}

/** Reconstructs the delivery as a Request so the SDK can verify it for real. */
function asRequest(call: { url: string; init: RequestInit }): Request {
  return new Request(call.url, {
    method: 'POST',
    headers: call.init.headers as HeadersInit,
    body: call.init.body as string,
  });
}

async function addWebhookEndpoint(url = URL_PUBLIC, enabled = true) {
  const endpoint = await endpoints.create({
    name: 'App',
    type: 'webhook',
    enabled,
  });

  await endpoints.setWebhookConfig({
    endpointId: endpoint.id,
    url,
    secretCiphertext: encryptSecret(SECRET),
  });

  await endpoints.bindToAddress(address.id, endpoint.id);
  return endpoint.id;
}

beforeEach(async () => {
  domains = new InMemoryDomainRepository();
  addresses = new InMemoryAddressRepository(domains);
  threads = new InMemoryThreadRepository();
  events = new InMemoryEventRepository();
  emails = new InMemoryEmailRepository(threads, events);
  endpoints = new InMemoryEndpointRepository();
  deliveries = new InMemoryDeliveryRepository();

  const domain = await domains.create({
    name: DOMAIN,
    providerDomainId: DOMAIN,
    status: 'verified',
    dnsRecords: [],
  });

  const created = await addresses.create({
    domainId: domain.id,
    localPart: 'support',
    providerAliasId: 'alias_1',
    canSend: true,
    enabled: true,
  });

  address = (await addresses.findByIdWithDomain(created.id))!;

  const captured = await emails.createInbound({
    email: {
      id: 'em_fixture',
      threadId: null,
      addressId: address.id,
      providerMessageId: 'fe_1',
      messageId: '<customer-1@example.com>',
      fingerprint: 'fp_1',
      direction: 'inbound',
      status: 'received',
      from: '"Ada Lovelace" <customer@example.com>',
      to: [`support@${DOMAIN}`],
      cc: [],
      subject: 'Transcription is not working',
      text: 'Hi there',
      html: '<p>Hi there</p>',
      inReplyTo: null,
      references: [],
      rawStorageKey: null,
      receivedAt: new Date('2026-09-05T12:00:00.000Z'),
      sentAt: null,
    },
    attachments: [
      {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        storageKey: 'attachments/em_fixture/att_1',
      },
    ],
    eventMetadata: {
      provider: 'mock',
      recipient: `support@${DOMAIN}`,
      envelopeSender: 'customer@example.com',
      envelopeRecipients: [`support@${DOMAIN}`],
    },
    thread: { subject: 'Transcription is not working' },
  });

  email = captured.email!;
  event = captured.event!;

  endpointId = await addWebhookEndpoint();
});

describe('delivery', () => {
  it('posts to the endpoint and records the delivery as delivered', async () => {
    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));

    const result = await serviceWith(impl).dispatch({ email, address, event });

    expect(result).toEqual({ delivered: 1, failed: 0, skipped: 0 });
    expect(calls).toHaveLength(1);

    const [row] = await deliveries.listForEndpoint(endpointId);
    expect(row.status).toBe('delivered');
    expect(row.responseCode).toBe(200);
    expect(row.attempt).toBe(1);
    expect(row.deliveredAt).not.toBeNull();
  });

  it('emits queued and delivered events against the message', async () => {
    const { impl } = recordingFetch(() => new Response(null, { status: 204 }));
    await serviceWith(impl).dispatch({ email, address, event });

    const types = events.rows
      .filter((row) => row.emailId === email.id)
      .map((row) => row.type);

    // Capture first, then the fan-out. The order is the audit trail: a webhook
    // event that preceded `email.received` would mean we delivered a message we
    // had not yet stored.
    expect(types).toEqual([
      'email.received',
      'webhook.queued',
      'webhook.delivered',
    ]);
  });

  it('signs a delivery the published SDK can verify', async () => {
    // The whole chain in one assertion: the secret is encrypted at rest,
    // decrypted to sign, and the signature is checked by the same code a
    // customer runs. A signer and a verifier that only agree with themselves
    // are the classic way this breaks.
    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    await serviceWith(impl).dispatch({ email, address, event });

    const payload = await verifyWebhook<MailpistonWebhookEvent>(
      asRequest(calls[0]),
      SECRET,
    );

    expect(payload.version).toBe('1');
    expect(payload.type).toBe('email.received');
    expect(payload.id).toBe(event.id);
    expect(payload.data.subject).toBe('Transcription is not working');
  });

  it('rejects verification under a different secret', async () => {
    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    await serviceWith(impl).dispatch({ email, address, event });

    await expect(
      verifyWebhook(asRequest(calls[0]), 'not-the-secret'),
    ).rejects.toThrow(/Signature does not match/);
  });

  it('sends the documented headers', async () => {
    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    await serviceWith(impl).dispatch({ email, address, event });

    const headers = calls[0].init.headers as Record<string, string>;
    const [row] = await deliveries.listForEndpoint(endpointId);

    expect(headers[MAILPISTON_HEADERS.event]).toBe('email.received');
    expect(headers[MAILPISTON_HEADERS.deliveryId]).toBe(row.id);
    expect(headers[MAILPISTON_HEADERS.signature]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(Number(headers[MAILPISTON_HEADERS.timestamp])).toBeGreaterThan(0);
  });
});

describe('failure', () => {
  it('leaves a pending delivery with the response code, and never throws', async () => {
    // The acceptance criterion in full: the receiver 500s, we record it, and
    // ingress is untouched — the message is already durable, so a non-200 back
    // to the mail provider would trigger a retry that deduplicates and costs
    // the operator the mail itself.
    const { impl } = recordingFetch(
      () => new Response('kaboom', { status: 500 }),
    );

    const result = await serviceWith(impl).dispatch({ email, address, event });

    expect(result).toEqual({ delivered: 0, failed: 1, skipped: 0 });

    const [row] = await deliveries.listForEndpoint(endpointId);
    expect(row.status).toBe('pending');
    expect(row.responseCode).toBe(500);
    expect(row.attempt).toBe(1);
    expect(row.lastError).toContain('kaboom');

    expect(events.rows.map((e) => e.type)).toContain('webhook.failed');
  });

  it('records a transport failure with no response code', async () => {
    const impl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await serviceWith(impl).dispatch({ email, address, event });

    const [row] = await deliveries.listForEndpoint(endpointId);
    expect(row.status).toBe('pending');
    expect(row.responseCode).toBeNull();
    expect(row.lastError).toContain('ECONNREFUSED');
  });

  it('fails an endpoint that resolves into private space without sending anything', async () => {
    endpoints = new InMemoryEndpointRepository();
    deliveries = new InMemoryDeliveryRepository();
    endpointId = await addWebhookEndpoint('https://127.0.0.1/hook');

    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    await serviceWith(impl).dispatch({ email, address, event });

    // The guard runs before the request, not after it.
    expect(calls).toHaveLength(0);

    const [row] = await deliveries.listForEndpoint(endpointId);
    expect(row.status).toBe('pending');
    expect(row.lastError).toContain('private address');
  });
});

describe('routing', () => {
  it('delivers an event once, however many times it is dispatched', async () => {
    // Two concurrent ingests of the same event must elect one deliverer. The
    // unique index on (event, endpoint, recipient) is what does the electing.
    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    const service = serviceWith(impl);

    await service.dispatch({ email, address, event });
    const second = await service.dispatch({ email, address, event });

    expect(calls).toHaveLength(1);
    expect(second).toEqual({ delivered: 0, failed: 0, skipped: 1 });
  });

  it('ignores a disabled endpoint', async () => {
    endpoints = new InMemoryEndpointRepository();
    deliveries = new InMemoryDeliveryRepository();
    await addWebhookEndpoint(URL_PUBLIC, false);

    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    await serviceWith(impl).dispatch({ email, address, event });

    expect(calls).toHaveLength(0);
  });

  it('ignores mailbox endpoints bound to the same address', async () => {
    // An address fans out to both kinds at once; each subtype delivers through
    // its own path, and neither may pick up the other's endpoints.
    const mailbox = await endpoints.create({
      name: 'My inbox',
      type: 'email',
      enabled: true,
    });
    await endpoints.bindToAddress(address.id, mailbox.id);

    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    await serviceWith(impl).dispatch({ email, address, event });

    expect(calls).toHaveLength(1);
  });

  it('does not deliver an event type webhooks do not carry', async () => {
    const rejected = await events.create({
      emailId: null,
      type: 'email.rejected',
      metadata: {},
    });

    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    const result = await serviceWith(impl).dispatch({
      email,
      address,
      event: rejected,
    });

    expect(calls).toHaveLength(0);
    expect(result).toEqual({ delivered: 0, failed: 0, skipped: 0 });
  });
});

describe('payload', () => {
  it('carries attachment metadata and a download URL, never bytes', async () => {
    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    await serviceWith(impl).dispatch({ email, address, event });

    const payload = JSON.parse(calls[0].init.body as string) as MailpistonWebhookEvent;
    const [attachment] = payload.data.attachments;

    expect(attachment.filename).toBe('invoice.pdf');
    expect(attachment.sizeBytes).toBe(2048);
    expect(attachment.downloadUrl).toBe(
      `https://mailpiston.test/api/v1/attachments/${attachment.id}/download`,
    );
    expect(JSON.stringify(attachment)).not.toContain('storageKey');
  });

  it('keeps internal fields out of the public contract', async () => {
    // Fingerprints, storage keys, and provider ids are ours. Anything that
    // crosses this boundary is a compatibility promise we did not mean to make.
    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    await serviceWith(impl).dispatch({ email, address, event });

    const body = calls[0].init.body as string;

    expect(body).not.toContain('fingerprint');
    expect(body).not.toContain('rawStorageKey');
    expect(body).not.toContain('providerMessageId');
  });

  it('separates the envelope from the headers', async () => {
    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));
    await serviceWith(impl).dispatch({ email, address, event });

    const payload = JSON.parse(calls[0].init.body as string) as MailpistonWebhookEvent;

    expect(payload.data.envelope).toEqual({
      from: 'customer@example.com',
      recipients: [`support@${DOMAIN}`],
    });
    expect(payload.data.from).toEqual({
      name: 'Ada Lovelace',
      email: 'customer@example.com',
    });
  });
});

describe('test delivery', () => {
  it('posts a sample payload and records no delivery row', async () => {
    const { impl, calls } = recordingFetch(() => new Response('ok', { status: 200 }));

    const result = await serviceWith(impl).test(endpointId);

    expect(result).toEqual({ ok: true, responseCode: 200, error: null });
    expect(calls).toHaveLength(1);
    // The log is the audit trail of real mail; a test entry in it would be
    // indistinguishable from one.
    expect(await deliveries.listForEndpoint(endpointId)).toHaveLength(0);
  });

  it('reports a failing receiver without throwing', async () => {
    const { impl } = recordingFetch(() => new Response('nope', { status: 503 }));

    const result = await serviceWith(impl).test(endpointId);

    expect(result.ok).toBe(false);
    expect(result.responseCode).toBe(503);
    expect(result.error).toContain('nope');
  });

  it('refuses a mailbox endpoint', async () => {
    const mailbox = await endpoints.create({
      name: 'My inbox',
      type: 'email',
      enabled: true,
    });

    const { impl } = recordingFetch(() => new Response('ok', { status: 200 }));

    await expect(serviceWith(impl).test(mailbox.id)).rejects.toThrow(
      /not a webhook endpoint/,
    );
  });
});

describe('retry surface', () => {
  it('re-attempts a pending delivery and can succeed the second time', async () => {
    // Phase 8 drives this behind an atomic claim. What matters here is that the
    // payload is rebuilt from the event, so the event id a receiver dedupes on
    // survives the retry unchanged.
    const failing = recordingFetch(() => new Response('down', { status: 502 }));
    await serviceWith(failing.impl).dispatch({ email, address, event });

    const [pending] = await deliveries.listForEndpoint(endpointId);
    expect(pending.status).toBe('pending');

    const succeeding = recordingFetch(() => new Response('ok', { status: 200 }));
    const outcome = await serviceWith(succeeding.impl).attempt(pending.id);

    expect(outcome.ok).toBe(true);

    const payload = JSON.parse(
      succeeding.calls[0].init.body as string,
    ) as MailpistonWebhookEvent;
    expect(payload.id).toBe(event.id);

    const [row] = await deliveries.listForEndpoint(endpointId);
    expect(row.status).toBe('delivered');
    expect(row.attempt).toBe(2);
  });
});
