import 'server-only';

import { inboundIngressUrl } from '@/server/core/config';
import { ConflictError, NotFoundError } from '@/server/core/errors';
import type { Address, AddressWithDomain } from '@/server/core/types';
import type { MailProvider } from '@/server/providers/registry';
import type {
  AddressRepository,
  DomainRepository,
} from '@/server/repositories/types';

/**
 * Address CRUD (roadmap Phase 3), built around one distinction:
 *
 *  - `canSend: false` — an inbound-only local route. Purely local, behind the
 *    domain's optional catch-all. No provider call, no `providerAliasId`.
 *  - `canSend: true`  — a concrete provider alias pointing at our ingress.
 *    Required, because Forward Email will not authorise a `From:` for an
 *    address that exists only behind a catch-all (roadmap §5.6).
 *
 * An inbound-only address with no catch-all on its domain would simply never
 * receive anything, so that combination is refused rather than silently
 * created.
 */
export class AddressService {
  constructor(
    private readonly addresses: AddressRepository,
    private readonly domains: DomainRepository,
    private readonly provider: MailProvider,
  ) {}

  async create(input: {
    domainId: string;
    localPart: string;
    canSend: boolean;
    enabled: boolean;
  }): Promise<Address> {
    const domain = await this.domains.findById(input.domainId);
    if (!domain) throw new NotFoundError(`Domain ${input.domainId} not found`);

    const localPart = input.localPart.toLowerCase();

    const duplicate = await this.addresses.findByDomainAndLocalPart(
      domain.id,
      localPart,
    );
    if (duplicate) {
      throw new ConflictError(`${localPart}@${domain.name} already exists`);
    }

    if (!input.canSend && !domain.catchAllAliasId) {
      throw new ConflictError(
        `${domain.name} has no catch-all, so an inbound-only address would never receive mail. ` +
          'Enable sending for this address, or add a catch-all to the domain.',
      );
    }

    let providerAliasId: string | null = null;
    let rollbackProviderChange: (() => Promise<void>) | null = null;

    if (input.canSend) {
      if (!domain.providerDomainId) {
        throw new ConflictError(`Domain ${domain.name} has no provider record`);
      }

      const providerDomainId = domain.providerDomainId;
      const ingressUrl = inboundIngressUrl();
      const existingAlias = await this.provider.findAlias(
        providerDomainId,
        localPart,
      );

      const alias = existingAlias
        ? await this.provider.updateAlias(existingAlias.id, {
            domainId: providerDomainId,
            recipients: Array.from(
              new Set([...existingAlias.recipients, ingressUrl]),
            ),
            enabled: input.enabled,
          })
        : await this.provider.createAlias({
            domainId: providerDomainId,
            localPart,
            recipients: [ingressUrl],
            enabled: input.enabled,
            description: 'Managed by MailPiston',
          });

      providerAliasId = alias.id;
      rollbackProviderChange = existingAlias
        ? () =>
            this.provider.updateAlias(existingAlias.id, {
              domainId: providerDomainId,
              recipients: existingAlias.recipients,
              enabled: existingAlias.enabled,
            }).then(() => undefined)
        : () => this.provider.deleteAlias(alias.id, providerDomainId);
    }

    try {
      return await this.addresses.create({
        domainId: domain.id,
        localPart,
        providerAliasId,
        canSend: input.canSend,
        enabled: input.enabled,
      });
    } catch (error) {
      // Restore the provider to its prior state if the local row did not land.
      // For an adopted alias this preserves its original recipients; for a new
      // alias it removes the orphan created by this attempt.
      if (rollbackProviderChange) {
        await rollbackProviderChange().catch((cleanupError: unknown) => {
            console.error(
              `Could not roll back provider alias ${providerAliasId} on ${domain.name}`,
              cleanupError,
            );
        });
      }

      throw error;
    }
  }

  async get(id: string): Promise<Address> {
    const address = await this.addresses.findById(id);
    if (!address) throw new NotFoundError(`Address ${id} not found`);
    return address;
  }

  list(filter?: { domainId?: string }): Promise<AddressWithDomain[]> {
    return this.addresses.list(filter);
  }

  /** Inbound routing entry point. Returns null for an unknown local part. */
  resolve(email: string): Promise<AddressWithDomain | null> {
    return this.addresses.findByEmail(email);
  }

  /**
   * Enabling or disabling an address must reach the provider too when a
   * concrete alias exists, or a disabled address keeps receiving mail.
   */
  async update(
    id: string,
    input: { enabled?: boolean; canSend?: boolean },
  ): Promise<Address> {
    const address = await this.get(id);
    const domain = await this.domains.findById(address.domainId);
    if (!domain) throw new NotFoundError(`Domain ${address.domainId} not found`);

    let providerAliasId = address.providerAliasId;

    // Turning sending on for an existing inbound-only address means creating
    // the concrete alias it never had.
    if (input.canSend === true && !providerAliasId) {
      if (!domain.providerDomainId) {
        throw new ConflictError(`Domain ${domain.name} has no provider record`);
      }

      const alias = await this.provider.createAlias({
        domainId: domain.providerDomainId,
        localPart: address.localPart,
        recipients: [inboundIngressUrl()],
        enabled: input.enabled ?? address.enabled,
        description: 'Managed by MailPiston',
      });

      providerAliasId = alias.id;
    } else if (
      providerAliasId &&
      input.enabled !== undefined &&
      domain.providerDomainId
    ) {
      await this.provider.updateAlias(providerAliasId, {
        domainId: domain.providerDomainId,
        enabled: input.enabled,
      });
    }

    return this.addresses.update(id, { ...input, providerAliasId });
  }

  async delete(id: string): Promise<void> {
    const address = await this.get(id);

    if (address.providerAliasId) {
      const domain = await this.domains.findById(address.domainId);

      if (domain?.providerDomainId) {
        await this.provider.deleteAlias(
          address.providerAliasId,
          domain.providerDomainId,
        );
      }
    }

    await this.addresses.delete(id);
  }
}
