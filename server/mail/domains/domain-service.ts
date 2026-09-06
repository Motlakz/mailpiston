import 'server-only';

import { inboundIngressUrl } from '@/server/core/config';
import { ConflictError, NotFoundError } from '@/server/core/errors';
import type { Domain } from '@/server/core/types';
import type { MailProvider } from '@/server/providers/registry';
import type { DomainRepository } from '@/server/repositories/types';

/**
 * Onboarding a domain (roadmap Phase 3).
 *
 * The flow is: create at the provider → persist `pending` with the DNS records
 * the operator must publish → they publish → `verify()` polls the provider
 * until the records are visible → `verified` or `failed`.
 *
 * The optional catch-all alias is created here, not in `AddressService`: it is
 * domain configuration, and it is what lets inbound-only addresses exist with
 * no per-address provider call at all.
 */
export class DomainService {
  constructor(
    private readonly domains: DomainRepository,
    private readonly provider: MailProvider,
  ) {}

  async create(input: { name: string; createCatchAll?: boolean }): Promise<Domain> {
    const name = input.name.toLowerCase();

    // Check locally first so a duplicate is a 409 rather than a provider error
    // we then have to interpret.
    const existing = await this.domains.findByName(name);
    if (existing) throw new ConflictError(`Domain ${name} already exists`);

    // Adopt a domain already present in the connected provider account. This
    // keeps MailPiston's local state authoritative without making operators
    // delete and recreate provider configuration during onboarding.
    const providerDomain =
      (await this.provider.findDomain(name)) ??
      (await this.provider.createDomain({ name }));

    const domain = await this.domains.create({
      name,
      providerDomainId: providerDomain.id,
      status: providerDomain.verified ? 'verified' : 'pending',
      dnsRecords: providerDomain.records,
    });

    if (input.createCatchAll) {
      return this.createCatchAll(domain.id);
    }

    return domain;
  }

  async get(id: string): Promise<Domain> {
    const domain = await this.domains.findById(id);
    if (!domain) throw new NotFoundError(`Domain ${id} not found`);
    return domain;
  }

  list(): Promise<Domain[]> {
    return this.domains.list();
  }

  /**
   * Polls the provider for the DNS records and records the outcome.
   *
   * `failed` is not terminal — DNS propagates, so an operator re-runs this
   * after the records land. It only distinguishes "we checked and it did not
   * pass" from "we have never checked".
   */
  async verify(id: string): Promise<Domain> {
    const domain = await this.get(id);

    if (!domain.providerDomainId) {
      throw new ConflictError(
        `Domain ${domain.name} has no provider record to verify against`,
      );
    }

    const verification = await this.provider.verifyDomain(domain.providerDomainId);

    return this.domains.update(id, {
      status: verification.verified ? 'verified' : 'failed',
      dnsRecords: verification.records,
      verificationErrors: verification.errors,
      lastVerifiedAt: new Date(),
    });
  }

  /**
   * Points `*@domain` at our ingress.
   *
   * The cost of this is that we then receive mail for local parts that do not
   * exist. The inbound pipeline resolves the recipient locally and drops
   * unknown ones with a recorded `email.rejected` event and a 200 — it must not
   * bounce, because bouncing a catch-all is backscatter (roadmap §1.2).
   */
  async createCatchAll(id: string): Promise<Domain> {
    const domain = await this.get(id);

    if (domain.catchAllAliasId) return domain;
    if (!domain.providerDomainId) {
      throw new ConflictError(`Domain ${domain.name} has no provider record`);
    }

    const alias = await this.provider.createAlias({
      domainId: domain.providerDomainId,
      localPart: '*',
      recipients: [inboundIngressUrl()],
      description: 'MailPiston catch-all ingress',
    });

    return this.domains.update(id, { catchAllAliasId: alias.id });
  }

  async removeCatchAll(id: string): Promise<Domain> {
    const domain = await this.get(id);

    if (!domain.catchAllAliasId || !domain.providerDomainId) return domain;

    await this.provider.deleteAlias(domain.catchAllAliasId, domain.providerDomainId);
    return this.domains.update(id, { catchAllAliasId: null });
  }

  /**
   * Deletes locally and at the provider.
   *
   * Provider first: if the local row goes first and the provider call then
   * fails, we have orphaned a domain we can no longer see, and reconciliation
   * has nothing to compare against.
   */
  async delete(id: string): Promise<void> {
    const domain = await this.get(id);

    if (domain.providerDomainId) {
      await this.provider.deleteDomain(domain.providerDomainId);
    }

    await this.domains.delete(id);
  }
}
