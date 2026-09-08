import 'server-only';

import { inboundIngressUrl } from '@/server/core/config';
import type {
  Address,
  Domain,
  ReconciliationItemStatus,
  ReconciliationRun,
} from '@/server/core/types';
import type { MailProvider } from '@/server/providers/types';
import type { ProviderAlias } from '@/server/providers/types';
import type {
  AddressRepository,
  DomainRepository,
  ReconciliationRepository,
} from '@/server/repositories/types';

/**
 * Provider reconciliation (roadmap Phase 10).
 *
 * MailPiston's local state and the provider's are two copies of one
 * configuration, and the provider's is the one that actually routes mail. They
 * drift for ordinary reasons — somebody deletes an alias in the provider
 * dashboard, an app origin moves and leaves every alias pointing at a dead URL,
 * a domain is removed. None of that produces an error anywhere: mail simply
 * stops arriving, and the dashboard goes on looking correct.
 *
 * So this sweep exists to notice. Three rules:
 *
 * **It never repairs.** Not once, not "obviously safe" cases. An automatic
 * repair racing an operator who is mid-change turns a visible problem into an
 * argument between two writers, and the failure mode of a wrong repair is
 * routing a customer's mail somewhere unintended. Repair is a button, on
 * `DomainService`, pressed by a human who has read the finding.
 *
 * **It records "we could not tell" as a finding.** A provider call that throws
 * is an `error` item, not a skipped one. Silence here would read as "checked,
 * fine", which is the one thing it must never mean.
 *
 * **It compares in one direction only.** Provider domains we do not know about
 * are not drift: Phase 3 adopts existing domains, and an operator's Forward
 * Email account may legitimately hold domains MailPiston does not manage.
 * Flagging them would train everyone to ignore the banner.
 */
export interface ReconciliationSummary {
  run: ReconciliationRun;
  checked: number;
  drift: number;
  missing: number;
  errors: number;
}

export class ReconciliationService {
  constructor(
    private readonly runs: ReconciliationRepository,
    private readonly domains: DomainRepository,
    private readonly addresses: AddressRepository,
    private readonly provider: MailProvider,
  ) {}

  async run(): Promise<ReconciliationSummary> {
    // Opened before any comparison, so a crash mid-sweep leaves a `running`
    // row rather than no trace that we tried.
    const run = await this.runs.startRun(this.provider.id);
    const tally = { checked: 0, drift: 0, missing: 0, errors: 0 };

    const record = async (
      resourceType: string,
      resourceId: string,
      status: ReconciliationItemStatus,
      detail: Record<string, unknown>,
    ) => {
      await this.runs.addItem({
        runId: run.id,
        resourceType,
        resourceId,
        status,
        detail,
      });

      tally.checked += 1;
      if (status === 'drift') tally.drift += 1;
      if (status === 'missing') tally.missing += 1;
      if (status === 'error') tally.errors += 1;
    };

    try {
      const [domains, addresses] = await Promise.all([
        this.domains.list(),
        this.addresses.list(),
      ]);

      for (const domain of domains) {
        // One domain failing must not end the sweep — the domain after it might
        // be the one that is actually broken.
        try {
          await this.checkDomain(
            domain,
            addresses.filter((address) => address.domainId === domain.id),
            record,
          );
        } catch (error) {
          await record('domain', domain.id, 'error', {
            name: domain.name,
            error: (error as Error).message,
          });
        }
      }

      const finished = await this.runs.finishRun(run.id, 'completed');
      return { run: finished, ...tally };
    } catch (error) {
      const finished = await this.runs.finishRun(
        run.id,
        'failed',
        (error as Error).message,
      );
      return { run: finished, ...tally };
    }
  }

  private async checkDomain(
    domain: Domain,
    addresses: Address[],
    record: (
      resourceType: string,
      resourceId: string,
      status: ReconciliationItemStatus,
      detail: Record<string, unknown>,
    ) => Promise<void>,
  ): Promise<void> {
    if (!domain.providerDomainId) {
      await record('domain', domain.id, 'missing', {
        name: domain.name,
        reason: 'no_provider_domain_id',
      });
      return;
    }

    const providerDomain = await this.provider.findDomain(domain.name);

    if (!providerDomain) {
      // The loudest finding there is: the domain is gone at the provider, so
      // nothing addressed to it reaches us at all.
      await record('domain', domain.id, 'missing', {
        name: domain.name,
        reason: 'not_found_at_provider',
      });
      return;
    }

    if (providerDomain.id !== domain.providerDomainId) {
      // Usually means the domain was deleted and recreated at the provider.
      // Every alias id we hold belongs to the old one.
      await record('domain', domain.id, 'drift', {
        name: domain.name,
        reason: 'provider_domain_id_changed',
        expected: domain.providerDomainId,
        actual: providerDomain.id,
      });
    } else if (domain.status === 'verified' && !providerDomain.verified) {
      await record('domain', domain.id, 'drift', {
        name: domain.name,
        reason: 'no_longer_verified_at_provider',
      });
    } else {
      await record('domain', domain.id, 'ok', { name: domain.name });
    }

    await this.checkAliases(domain, providerDomain.id, addresses, record);
  }

  /**
   * The alias check, which is the one that actually costs mail when it drifts.
   *
   * Every alias MailPiston creates has the absolute ingress URL as its
   * recipient. An alias that is deleted, disabled, or repointed stops delivering
   * to us — silently, and with no error anywhere in the system. That is why the
   * ingress URL is compared by value and not merely for existence.
   *
   * The roadmap scopes this phase to the catch-all. Concrete address aliases are
   * checked too: `listAliases` already returns them in the same call, and an
   * address alias repointed is the same failure with a narrower blast radius —
   * one mailbox stops receiving instead of all of them.
   */
  private async checkAliases(
    domain: Domain,
    providerDomainId: string,
    addresses: Address[],
    record: (
      resourceType: string,
      resourceId: string,
      status: ReconciliationItemStatus,
      detail: Record<string, unknown>,
    ) => Promise<void>,
  ): Promise<void> {
    const expectedIngress = inboundIngressUrl();

    const tracked = [
      ...(domain.catchAllAliasId
        ? [{ id: domain.catchAllAliasId, localPart: '*', resourceId: domain.id }]
        : []),
      ...addresses
        .filter((address) => address.providerAliasId)
        .map((address) => ({
          id: address.providerAliasId!,
          localPart: address.localPart,
          resourceId: address.id,
        })),
    ];

    if (tracked.length === 0) return;

    const aliases = await this.provider.listAliases(providerDomainId);
    const byId = new Map(aliases.map((alias) => [alias.id, alias]));

    for (const expected of tracked) {
      const alias = byId.get(expected.id);

      if (!alias) {
        await record('alias', expected.resourceId, 'missing', {
          domain: domain.name,
          localPart: expected.localPart,
          aliasId: expected.id,
          reason: 'not_found_at_provider',
        });
        continue;
      }

      const problem = aliasProblem(alias, expected.localPart, expectedIngress);

      await record(
        'alias',
        expected.resourceId,
        problem ? 'drift' : 'ok',
        problem
          ? {
              domain: domain.name,
              localPart: expected.localPart,
              aliasId: alias.id,
              ...problem,
            }
          : { domain: domain.name, localPart: expected.localPart },
      );
    }
  }
}

/** The first thing wrong with an alias, or null if it is as we left it. */
function aliasProblem(
  alias: ProviderAlias,
  expectedLocalPart: string,
  expectedIngress: string,
): Record<string, unknown> | null {
  if (!alias.enabled) {
    return { reason: 'disabled_at_provider' };
  }

  if (alias.localPart.toLowerCase() !== expectedLocalPart.toLowerCase()) {
    return {
      reason: 'local_part_changed',
      expected: expectedLocalPart,
      actual: alias.localPart,
    };
  }

  if (!alias.recipients.includes(expectedIngress)) {
    return {
      reason: 'recipient_not_our_ingress',
      expected: expectedIngress,
      actual: alias.recipients,
    };
  }

  // Extra recipients alongside ours are worth surfacing rather than accepting:
  // it means a copy of the operator's customer mail is being delivered
  // somewhere MailPiston does not know about.
  if (alias.recipients.length > 1) {
    return {
      reason: 'additional_recipients',
      expected: expectedIngress,
      actual: alias.recipients,
    };
  }

  return null;
}
