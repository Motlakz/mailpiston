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

  it('adopts a catch-all that already exists at the provider', async () => {
    // Importing a domain that was already set up by hand. The provider has the
    // `*` alias; we have no record of it, so the create path used to POST a
    // second one and surface the provider's 400 to the operator.
    const providerDomain = await provider.createDomain({
      name: 'existing-domain.test',
    });
    await provider.verifyDomain(providerDomain.id);
    const existing = await provider.createAlias({
      domainId: providerDomain.id,
      localPart: '*',
      recipients: ['someone@elsewhere.test'],
    });

    const domain = await domains.create({
      name: 'existing-domain.test',
      createCatchAll: true,
    });

    expect(domain.catchAllAliasId).toBe(existing.id);
    expect(await provider.listAliases('existing-domain.test')).toHaveLength(1);
  });

  it('leaves an adopted catch-all pointing where it already pointed', async () => {
    // Pressing Add must not reroute mail as a side effect. Repointing is the
    // Repair catch-all action, which the operator takes deliberately.
    const providerDomain = await provider.createDomain({
      name: 'existing-domain.test',
    });
    await provider.verifyDomain(providerDomain.id);
    await provider.createAlias({
      domainId: providerDomain.id,
      localPart: '*',
      recipients: ['someone@elsewhere.test'],
    });

    const domain = await domains.create({
      name: 'existing-domain.test',
      createCatchAll: true,
    });

    const [adopted] = await provider.listAliases('existing-domain.test');
    expect(adopted.recipients).toEqual(['someone@elsewhere.test']);

    // Repair is the action that repoints it, and it still works on an adopted
    // alias — so the operator is one explicit click from correct routing.
    await domains.repairCatchAll(domain.id);

    const [repaired] = await provider.listAliases('existing-domain.test');
    expect(repaired.recipients).toEqual([
      expect.stringContaining('/api/providers/forward-email/inbound'),
    ]);
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

  it('selects a verified reply domain and explicitly points its catch-all at ingress', async () => {
    const domain = await verifiedDomain('reply-domain.test');

    const selected = await domains.configureRelay(domain.id);
    const alias = await provider.findAlias(domain.providerDomainId!, '*');

    expect(selected.relayEnabled).toBe(true);
    expect(selected.catchAllAliasId).toBe(alias?.id);
    expect(alias?.recipients).toEqual([
      expect.stringContaining('/api/providers/forward-email/inbound'),
    ]);
  });

  it('keeps only one reply domain selected per workspace', async () => {
    const first = await verifiedDomain('first-relay.test');
    const second = await verifiedDomain('second-relay.test');

    await domains.configureRelay(first.id);
    await domains.configureRelay(second.id);

    expect((await domainRepo.findById(first.id))?.relayEnabled).toBe(false);
    expect((await domainRepo.findById(second.id))?.relayEnabled).toBe(true);
  });

  it('refuses to select an unverified reply domain', async () => {
    const pending = await domains.create({ name: 'pending-relay.test' });

    await expect(domains.configureRelay(pending.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
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

  it('adopts an existing alias and preserves its forwarding recipients', async () => {
    const domain = await verifiedDomain();
    const existing = await provider.createAlias({
      domainId: 'fixture-domain.test',
      localPart: 'support',
      recipients: ['owner@example.com'],
      enabled: true,
    });

    const address = await addresses.create({
      domainId: domain.id,
      localPart: 'Support',
      canSend: true,
      enabled: true,
    });

    expect(address.providerAliasId).toBe(existing.id);
    const aliases = await provider.listAliases('fixture-domain.test');
    expect(aliases).toHaveLength(1);
    expect(aliases[0].recipients).toContain('owner@example.com');
    expect(
      aliases[0].recipients.some((recipient) =>
        recipient.endsWith('/api/providers/forward-email/inbound'),
      ),
    ).toBe(true);
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

  it('adopts an existing provider alias when sending is turned on later', async () => {
    const domain = await verifiedDomain('fixture-domain.test', true);

    const address = await addresses.create({
      domainId: domain.id,
      localPart: 'notifications',
      canSend: false,
      enabled: true,
    });

    // The operator had already made this alias at the provider by hand. It was
    // routed here by the catch-all, so we hold no alias id for it — and
    // creating one is the provider's "already exists" 400, not a new alias.
    const existing = await provider.createAlias({
      domainId: domain.providerDomainId!,
      localPart: 'notifications',
      recipients: ['someone@elsewhere.test'],
    });

    const updated = await addresses.update(address.id, { canSend: true });

    expect(updated.providerAliasId).toBe(existing.id);

    // Adopting adds our ingress rather than replacing what was there: the
    // operator's own forwarding keeps working and mail also reaches us.
    const alias = await provider.findAlias(
      domain.providerDomainId!,
      'notifications',
    );
    expect(alias?.recipients).toEqual([
      'someone@elsewhere.test',
      expect.stringContaining('/api/providers/forward-email/inbound'),
    ]);
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
