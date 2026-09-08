import { beforeEach, describe, expect, it, vi } from 'vitest';

import { inboundIngressUrl } from '@/server/core/config';
import { DomainService } from '@/server/mail/domains/domain-service';
import { MockMailProvider } from '@/server/providers/mock/provider';
import {
  InMemoryAddressRepository,
  InMemoryDomainRepository,
  InMemoryReconciliationRepository,
} from '@/server/test/in-memory-repositories';

import { ReconciliationService } from './reconciliation-service';

const DOMAIN = 'fixture-domain.test';

let domains: InMemoryDomainRepository;
let addresses: InMemoryAddressRepository;
let runs: InMemoryReconciliationRepository;
let provider: MockMailProvider;
let service: ReconciliationService;
let domainService: DomainService;
let domainId: string;

/** The findings of the latest run, ignoring everything that was fine. */
async function findings() {
  const run = await runs.latestRun();
  return (await runs.listItems(run!.id)).filter((item) => item.status !== 'ok');
}

async function itemsFor(resourceId: string) {
  const run = await runs.latestRun();
  return (await runs.listItems(run!.id)).filter(
    (item) => item.resourceId === resourceId,
  );
}

beforeEach(async () => {
  domains = new InMemoryDomainRepository();
  addresses = new InMemoryAddressRepository(domains);
  runs = new InMemoryReconciliationRepository();
  provider = new MockMailProvider();

  domainService = new DomainService(domains, provider);
  service = new ReconciliationService(runs, domains, addresses, provider);

  const domain = await domainService.create({
    name: DOMAIN,
    createCatchAll: true,
  });

  domainId = domain.id;
});

describe('a healthy account', () => {
  it('reports everything ok and completes the run', async () => {
    const summary = await service.run();

    expect(summary.run.status).toBe('completed');
    expect(summary.drift).toBe(0);
    expect(summary.missing).toBe(0);
    expect(summary.errors).toBe(0);
    // Domain and catch-all both checked. An "ok" item is what proves the sweep
    // ran at all — a result with only findings cannot tell the difference
    // between "13 fine" and "nothing checked".
    expect(summary.checked).toBe(2);
  });
});

describe('drift the sweep must catch', () => {
  it('notices a catch-all deleted in the provider dashboard', async () => {
    const domain = await domains.findById(domainId);
    await provider.deleteAlias(domain!.catchAllAliasId!);

    const summary = await service.run();

    expect(summary.missing).toBe(1);
    expect((await findings())[0]).toMatchObject({
      resourceType: 'alias',
      status: 'missing',
      detail: { localPart: '*', reason: 'not_found_at_provider' },
    });
  });

  it('notices a catch-all repointed at another URL', async () => {
    // The failure this whole phase exists for: nothing errors, the dashboard
    // still looks right, and mail simply stops arriving.
    const domain = await domains.findById(domainId);
    await provider.updateAlias(domain!.catchAllAliasId!, {
      domainId: DOMAIN,
      recipients: ['https://somewhere-else.example/hook'],
    });

    const summary = await service.run();

    expect(summary.drift).toBe(1);
    expect((await findings())[0]).toMatchObject({
      status: 'drift',
      detail: { reason: 'recipient_not_our_ingress' },
    });
  });

  it('notices an extra recipient alongside ours', async () => {
    // A copy of the operator's customer mail going somewhere MailPiston does
    // not know about. Delivery to us still works, which is what makes it easy
    // to miss.
    const domain = await domains.findById(domainId);
    await provider.updateAlias(domain!.catchAllAliasId!, {
      domainId: DOMAIN,
      recipients: [inboundIngressUrl(), 'someone@elsewhere.example'],
    });

    expect((await service.run()).drift).toBe(1);
    expect((await findings())[0].detail).toMatchObject({
      reason: 'additional_recipients',
    });
  });

  it('notices a disabled alias', async () => {
    const domain = await domains.findById(domainId);
    await provider.updateAlias(domain!.catchAllAliasId!, {
      domainId: DOMAIN,
      enabled: false,
    });

    expect((await service.run()).drift).toBe(1);
    expect((await findings())[0].detail).toMatchObject({
      reason: 'disabled_at_provider',
    });
  });

  it('notices a domain that no longer exists at the provider', async () => {
    await provider.deleteDomain(DOMAIN);

    const summary = await service.run();

    // The loudest finding there is: nothing addressed to the domain reaches us.
    expect(summary.missing).toBe(1);
    expect((await findings())[0]).toMatchObject({
      resourceType: 'domain',
      status: 'missing',
      detail: { reason: 'not_found_at_provider' },
    });
  });

  it('notices a domain recreated under a new provider id', async () => {
    await domains.update(domainId, { providerDomainId: 'stale-id' });

    expect((await service.run()).drift).toBe(1);
    expect((await findings())[0].detail).toMatchObject({
      reason: 'provider_domain_id_changed',
    });
  });

  it('checks concrete address aliases too, not just the catch-all', async () => {
    const alias = await provider.createAlias({
      domainId: DOMAIN,
      localPart: 'support',
      recipients: [inboundIngressUrl()],
    });

    const address = await addresses.create({
      domainId,
      localPart: 'support',
      providerAliasId: alias.id,
      canSend: true,
      enabled: true,
    });

    await provider.updateAlias(alias.id, {
      domainId: DOMAIN,
      recipients: ['https://somewhere-else.example/hook'],
    });

    await service.run();

    // Same failure as a drifted catch-all, narrower blast radius: one mailbox
    // silently stops receiving rather than all of them.
    expect(await itemsFor(address.id)).toMatchObject([
      { status: 'drift', detail: { localPart: 'support' } },
    ]);
  });
});

describe('what it refuses to do', () => {
  it('never repairs anything it finds', async () => {
    const domain = await domains.findById(domainId);
    await provider.deleteAlias(domain!.catchAllAliasId!);

    await service.run();

    // Still gone, and our row still points at the alias that no longer exists.
    expect(await provider.listAliases(DOMAIN)).toHaveLength(0);
    expect((await domains.findById(domainId))?.catchAllAliasId).toBe(
      domain!.catchAllAliasId,
    );
  });

  it('does not flag provider domains MailPiston does not manage', async () => {
    // Phase 3 adopts existing domains, so an operator's provider account may
    // legitimately hold others. Flagging them trains everyone to ignore the
    // banner.
    await provider.createDomain({ name: 'not-ours.test' });

    expect((await service.run()).drift).toBe(0);
  });
});

describe('when the provider will not answer', () => {
  it('records the failure as a finding rather than skipping it', async () => {
    // "We could not tell" must never render as "checked, fine".
    vi.spyOn(provider, 'findDomain').mockRejectedValueOnce(
      new Error('provider timed out'),
    );

    const summary = await service.run();

    expect(summary.run.status).toBe('completed');
    expect(summary.errors).toBe(1);
    expect((await findings())[0]).toMatchObject({
      resourceType: 'domain',
      status: 'error',
      detail: { error: 'provider timed out' },
    });
  });

  it('keeps checking the remaining domains', async () => {
    // The domain after the broken one might be the one that is actually wrong.
    await domainService.create({ name: 'second.test', createCatchAll: true });

    vi.spyOn(provider, 'findDomain').mockRejectedValueOnce(
      new Error('provider timed out'),
    );

    const summary = await service.run();

    expect(summary.errors).toBe(1);
    expect(summary.checked).toBeGreaterThan(1);
  });
});

describe('repair, which only a person triggers', () => {
  it('recreates a deleted catch-all and records the new alias', async () => {
    const before = await domains.findById(domainId);
    await provider.deleteAlias(before!.catchAllAliasId!);

    const repaired = await domainService.repairCatchAll(domainId);

    expect(repaired.catchAllAliasId).not.toBe(before!.catchAllAliasId);
    expect((await service.run()).drift + (await service.run()).missing).toBe(0);
  });

  it('repoints a drifted catch-all rather than deleting and recreating it', async () => {
    // Deleting first would open a window with no catch-all at all, and mail
    // arriving in that window is gone, not delayed.
    const before = await domains.findById(domainId);
    await provider.updateAlias(before!.catchAllAliasId!, {
      domainId: DOMAIN,
      recipients: ['https://somewhere-else.example/hook'],
    });

    const repaired = await domainService.repairCatchAll(domainId);

    expect(repaired.catchAllAliasId).toBe(before!.catchAllAliasId);
    expect((await provider.listAliases(DOMAIN))[0].recipients).toEqual([
      inboundIngressUrl(),
    ]);
    expect((await service.run()).drift).toBe(0);
  });

  it('finds the catch-all by local part, so a stale alias id still repairs', async () => {
    // Exactly the case a recreated provider domain produces: our stored alias
    // id belongs to the old domain and matches nothing.
    await domains.update(domainId, { catchAllAliasId: 'stale-alias-id' });

    const repaired = await domainService.repairCatchAll(domainId);

    expect(repaired.catchAllAliasId).not.toBe('stale-alias-id');
    expect(await provider.listAliases(DOMAIN)).toHaveLength(1);
  });
});
