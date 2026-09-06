import { beforeEach, describe, expect, it } from 'vitest';

import { ConflictError } from '@/server/core/errors';
import { DomainService } from '@/server/mail/domains/domain-service';
import { MockMailProvider } from '@/server/providers/mock/provider';
import {
  InMemoryAddressRepository,
  InMemoryDomainRepository,
} from '@/server/test/in-memory-repositories';

import { AddressService } from './address-service';

let provider: MockMailProvider;
let domainRepo: InMemoryDomainRepository;
let addressRepo: InMemoryAddressRepository;
let domains: DomainService;
let addresses: AddressService;

beforeEach(() => {
  provider = new MockMailProvider();
  domainRepo = new InMemoryDomainRepository();
  addressRepo = new InMemoryAddressRepository(domainRepo);
  domains = new DomainService(domainRepo, provider);
  addresses = new AddressService(addressRepo, domainRepo, provider);
});

async function verifiedDomain(name = 'fixture-domain.test', catchAll = false) {
  const domain = await domains.create({ name, createCatchAll: catchAll });
  return domains.verify(domain.id);
}

describe('DomainService', () => {
  it('creates a domain pending, with the records to publish', async () => {
    const domain = await domains.create({ name: 'Fixture-Domain.TEST' });

    expect(domain.name).toBe('fixture-domain.test');
    expect(domain.status).toBe('pending');
    expect(domain.dnsRecords.length).toBeGreaterThan(0);
    expect(domain.catchAllAliasId).toBeNull();
  });

  it('adopts a domain that already exists at the provider', async () => {
    const providerDomain = await provider.createDomain({
      name: 'existing-domain.test',
    });
    await provider.verifyDomain(providerDomain.id);

    const domain = await domains.create({ name: 'Existing-Domain.TEST' });

    expect(domain.name).toBe('existing-domain.test');
    expect(domain.providerDomainId).toBe(providerDomain.id);
    expect(domain.status).toBe('verified');
    expect(domain.dnsRecords.every((record) => record.present)).toBe(true);
  });

  it('rejects a duplicate domain with a ConflictError, not a 500', async () => {
    await domains.create({ name: 'fixture-domain.test' });

    await expect(
      domains.create({ name: 'FIXTURE-domain.test' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('verifies and records the outcome', async () => {
    const domain = await verifiedDomain();

    expect(domain.status).toBe('verified');
    expect(domain.lastVerifiedAt).toBeInstanceOf(Date);
    expect(domain.dnsRecords.every((record) => record.present)).toBe(true);
  });

  it('creates the catch-all only when asked, and only once', async () => {
    const domain = await domains.create({
      name: 'fixture-domain.test',
      createCatchAll: true,
    });

    expect(domain.catchAllAliasId).not.toBeNull();

    const aliases = await provider.listAliases('fixture-domain.test');
    expect(aliases.map((alias) => alias.localPart)).toEqual(['*']);
    expect(aliases[0].recipients[0]).toContain(
      '/api/providers/forward-email/inbound',
    );

    // Idempotent: asking again must not create a second catch-all.
    const again = await domains.createCatchAll(domain.id);
    expect(again.catchAllAliasId).toBe(domain.catchAllAliasId);
    expect(await provider.listAliases('fixture-domain.test')).toHaveLength(1);
  });

  it('removes the catch-all at the provider too', async () => {
    const domain = await domains.create({
      name: 'fixture-domain.test',
      createCatchAll: true,
    });

    const cleared = await domains.removeCatchAll(domain.id);

    expect(cleared.catchAllAliasId).toBeNull();
    expect(await provider.listAliases('fixture-domain.test')).toHaveLength(0);
  });
});

describe('AddressService', () => {
  it('creates a concrete provider alias for a send-capable address', async () => {
    const domain = await verifiedDomain();

    const address = await addresses.create({
      domainId: domain.id,
      localPart: 'Support',
      canSend: true,
      enabled: true,
    });

    expect(address.localPart).toBe('support');
    expect(address.providerAliasId).not.toBeNull();

    const aliases = await provider.listAliases('fixture-domain.test');
    expect(aliases).toHaveLength(1);
    // The alias must point at our ingress, or mail never reaches MailPiston.
    expect(aliases[0].recipients[0]).toContain(
      '/api/providers/forward-email/inbound',
    );
  });

  it('makes no provider call for an inbound-only address behind a catch-all', async () => {
    const domain = await verifiedDomain('fixture-domain.test', true);
    const before = await provider.listAliases('fixture-domain.test');

    const address = await addresses.create({
      domainId: domain.id,
      localPart: 'notifications',
      canSend: false,
      enabled: true,
    });

    expect(address.providerAliasId).toBeNull();
    // Still just the catch-all: no per-address alias was created.
    expect(await provider.listAliases('fixture-domain.test')).toHaveLength(
      before.length,
    );
  });

  it('refuses an inbound-only address on a domain with no catch-all', async () => {
    const domain = await verifiedDomain();

    // It would silently never receive anything, which is worse than an error.
    await expect(
      addresses.create({
        domainId: domain.id,
        localPart: 'notifications',
        canSend: false,
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a duplicate address with a ConflictError regardless of case', async () => {
    const domain = await verifiedDomain();

    await addresses.create({
      domainId: domain.id,
      localPart: 'support',
      canSend: true,
      enabled: true,
    });

    await expect(
      addresses.create({
        domainId: domain.id,
        localPart: 'SUPPORT',
        canSend: true,
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // And the failed attempt left no orphan alias at the provider.
    expect(await provider.listAliases('fixture-domain.test')).toHaveLength(1);
  });

  it('resolves an inbound recipient case-insensitively', async () => {
    const domain = await verifiedDomain();
    await addresses.create({
      domainId: domain.id,
      localPart: 'support',
      canSend: true,
      enabled: true,
    });

    const resolved = await addresses.resolve('SUPPORT@Fixture-Domain.TEST');

    expect(resolved?.email).toBe('support@fixture-domain.test');
    expect(await addresses.resolve('nobody@fixture-domain.test')).toBeNull();
  });

  it('creates the missing alias when sending is turned on later', async () => {
    const domain = await verifiedDomain('fixture-domain.test', true);

    const address = await addresses.create({
      domainId: domain.id,
      localPart: 'notifications',
      canSend: false,
      enabled: true,
    });

    const updated = await addresses.update(address.id, { canSend: true });

    expect(updated.providerAliasId).not.toBeNull();
    expect(await provider.listAliases('fixture-domain.test')).toHaveLength(2);
  });

  it('deletes the provider alias alongside the row', async () => {
    const domain = await verifiedDomain();
    const address = await addresses.create({
      domainId: domain.id,
      localPart: 'support',
      canSend: true,
      enabled: true,
    });

    await addresses.delete(address.id);

    expect(await provider.listAliases('fixture-domain.test')).toHaveLength(0);
    expect(await addressRepo.findById(address.id)).toBeNull();
  });
});
