import { beforeEach, describe, expect, it } from 'vitest';

import { decryptSecret } from '@/server/core/crypto';
import { OutboundService } from '@/server/mail/emails/outbound-service';
import { MockMailProvider } from '@/server/providers/mock/provider';
import {
  InMemoryAddressRepository,
  InMemoryDomainRepository,
  InMemoryEmailRepository,
  InMemoryEndpointRepository,
  InMemoryEventRepository,
  InMemoryThreadRepository,
} from '@/server/test/in-memory-repositories';

import { EndpointService } from './endpoint-service';

const URL_PUBLIC = 'https://93.184.216.34/hook';

let endpoints: InMemoryEndpointRepository;
let service: EndpointService;

beforeEach(() => {
  const domains = new InMemoryDomainRepository();
  const addresses = new InMemoryAddressRepository(domains);
  const threads = new InMemoryThreadRepository();
  const emails = new InMemoryEmailRepository(threads);
  const events = new InMemoryEventRepository();

  endpoints = new InMemoryEndpointRepository();

  service = new EndpointService(
    endpoints,
    addresses,
    new OutboundService(
      emails,
      addresses,
      events,
      threads,
      new MockMailProvider(),
    ),
  );
});

describe('creating a webhook endpoint', () => {
  it('returns the signing secret once and stores only ciphertext', async () => {
    const { endpoint, secret } = await service.create({
      name: 'App',
      type: 'webhook',
      url: URL_PUBLIC,
    });

    expect(secret).toBeTruthy();

    const config = await endpoints.getWebhookConfig(endpoint.id);
    expect(config?.url).toBe(URL_PUBLIC);
    // Encrypted rather than hashed, because the server has to recover it to
    // sign — but never stored in the clear.
    expect(config?.secretCiphertext).not.toContain(secret!);
    expect(decryptSecret(config!.secretCiphertext)).toBe(secret);
  });

  it('never hands the secret back on a read', async () => {
    const { endpoint, secret } = await service.create({
      name: 'App',
      type: 'webhook',
      url: URL_PUBLIC,
    });

    const url = await service.webhookUrl(endpoint.id);
    expect(url).toBe(URL_PUBLIC);
    expect(JSON.stringify(await service.get(endpoint.id))).not.toContain(secret!);
  });

  it('refuses a URL that is not https', async () => {
    await expect(
      service.create({ name: 'App', type: 'webhook', url: 'http://93.184.216.34/hook' }),
    ).rejects.toThrow(/must use https/);
  });

  it('refuses a URL pointing into private space', async () => {
    await expect(
      service.create({ name: 'App', type: 'webhook', url: 'https://127.0.0.1/hook' }),
    ).rejects.toThrow(/private address/);
  });

  it('leaves no endpoint behind when the URL is refused', async () => {
    // Same rule as a failed alias create in Phase 3: an endpoint that exists
    // with no destination looks configured and silently delivers nothing.
    await expect(
      service.create({ name: 'App', type: 'webhook', url: 'https://127.0.0.1/hook' }),
    ).rejects.toThrow();

    expect(await service.list()).toHaveLength(0);
  });

  it('refuses a webhook endpoint with no URL', async () => {
    await expect(service.create({ name: 'App', type: 'webhook' })).rejects.toThrow(
      /needs a URL/,
    );
  });

  it('refuses a URL on a mailbox endpoint', async () => {
    await expect(
      service.create({ name: 'My inbox', type: 'email', url: URL_PUBLIC }),
    ).rejects.toThrow(/Only a webhook endpoint takes a URL/);
  });
});

describe('rotating and repointing', () => {
  it('rotates to a new secret', async () => {
    const { endpoint, secret } = await service.create({
      name: 'App',
      type: 'webhook',
      url: URL_PUBLIC,
    });

    const rotated = await service.rotateSecret(endpoint.id);

    expect(rotated).not.toBe(secret);

    const config = await endpoints.getWebhookConfig(endpoint.id);
    expect(decryptSecret(config!.secretCiphertext)).toBe(rotated);
  });

  it('keeps the secret when only the URL changes', async () => {
    // The receiving application already has that secret deployed. Rotating it
    // as a side effect of a URL change would break every verification at the
    // new URL for a reason the operator never asked for.
    const { endpoint, secret } = await service.create({
      name: 'App',
      type: 'webhook',
      url: URL_PUBLIC,
    });

    await service.update(endpoint.id, { url: 'https://1.1.1.1/hook' });

    const config = await endpoints.getWebhookConfig(endpoint.id);
    expect(config?.url).toBe('https://1.1.1.1/hook');
    expect(decryptSecret(config!.secretCiphertext)).toBe(secret);
  });

  it('refuses to repoint at a private address', async () => {
    const { endpoint } = await service.create({
      name: 'App',
      type: 'webhook',
      url: URL_PUBLIC,
    });

    await expect(
      service.update(endpoint.id, { url: 'https://169.254.169.254/hook' }),
    ).rejects.toThrow(/private address/);

    expect((await endpoints.getWebhookConfig(endpoint.id))?.url).toBe(URL_PUBLIC);
  });

  it('refuses to rotate the secret of a mailbox endpoint', async () => {
    const { endpoint } = await service.create({ name: 'My inbox', type: 'email' });

    await expect(service.rotateSecret(endpoint.id)).rejects.toThrow(
      /not a webhook endpoint/,
    );
  });
});

describe('mailbox endpoints', () => {
  it('still refuses recipients on a webhook endpoint', async () => {
    const { endpoint } = await service.create({
      name: 'App',
      type: 'webhook',
      url: URL_PUBLIC,
    });

    await expect(
      service.addRecipient(endpoint.id, 'someone@personal.example'),
    ).rejects.toThrow(/do not take mail recipients/);
  });

  it('holds exactly one mailbox on an `email` endpoint', async () => {
    const { endpoint } = await service.create({ name: 'My inbox', type: 'email' });

    await service.addRecipient(endpoint.id, 'first@personal.example');

    await expect(
      service.addRecipient(endpoint.id, 'second@personal.example'),
    ).rejects.toThrow(/exactly one mailbox/);
  });
});
