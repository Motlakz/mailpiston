import { ConflictError, NotFoundError } from '@/server/core/errors';
import type { Address, AddressWithDomain, Domain } from '@/server/core/types';
import type {
  AddressRepository,
  CreateAddressData,
  CreateDomainData,
  DomainRepository,
  UpdateAddressData,
  UpdateDomainData,
} from '@/server/repositories/types';

/**
 * In-memory repositories for service tests.
 *
 * They reproduce the two constraints the Neon implementations rely on the
 * database for — case-insensitive uniqueness on the domain name and on
 * (domain, local part) — because those are exactly what the services are
 * expected to turn into a `ConflictError` rather than a 500.
 */
let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1)}`;

export class InMemoryDomainRepository implements DomainRepository {
  readonly rows = new Map<string, Domain>();

  async create(data: CreateDomainData): Promise<Domain> {
    if (await this.findByName(data.name)) {
      throw new ConflictError(`Domain ${data.name} already exists`);
    }

    const now = new Date();
    const domain: Domain = {
      id: nextId('dom'),
      name: data.name.toLowerCase(),
      providerDomainId: data.providerDomainId,
      status: data.status,
      catchAllAliasId: null,
      dnsRecords: data.dnsRecords,
      lastVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.rows.set(domain.id, domain);
    return domain;
  }

  async findById(id: string): Promise<Domain | null> {
    return this.rows.get(id) ?? null;
  }

  async findByName(name: string): Promise<Domain | null> {
    return (
      [...this.rows.values()].find(
        (domain) => domain.name === name.toLowerCase(),
      ) ?? null
    );
  }

  async list(): Promise<Domain[]> {
    return [...this.rows.values()];
  }

  async update(id: string, data: UpdateDomainData): Promise<Domain> {
    const existing = this.rows.get(id);
    if (!existing) throw new NotFoundError(`Domain ${id} not found`);

    const updated: Domain = { ...existing, ...data, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.rows.delete(id)) throw new NotFoundError(`Domain ${id} not found`);
  }
}

export class InMemoryAddressRepository implements AddressRepository {
  readonly rows = new Map<string, Address>();

  constructor(private readonly domains: InMemoryDomainRepository) {}

  async create(data: CreateAddressData): Promise<Address> {
    const duplicate = await this.findByDomainAndLocalPart(
      data.domainId,
      data.localPart,
    );

    if (duplicate) {
      throw new ConflictError(
        `Address ${data.localPart} already exists on that domain`,
      );
    }

    const now = new Date();
    const address: Address = {
      id: nextId('addr'),
      domainId: data.domainId,
      localPart: data.localPart.toLowerCase(),
      providerAliasId: data.providerAliasId,
      canSend: data.canSend,
      enabled: data.enabled,
      createdAt: now,
      updatedAt: now,
    };

    this.rows.set(address.id, address);
    return address;
  }

  async findById(id: string): Promise<Address | null> {
    return this.rows.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<AddressWithDomain | null> {
    const at = email.lastIndexOf('@');
    if (at <= 0) return null;

    const localPart = email.slice(0, at).toLowerCase();
    const domainName = email.slice(at + 1).toLowerCase();

    const domain = await this.domains.findByName(domainName);
    if (!domain) return null;

    const address = [...this.rows.values()].find(
      (row) => row.domainId === domain.id && row.localPart === localPart,
    );

    return address ? this.withDomain(address, domain.name) : null;
  }

  async findByDomainAndLocalPart(
    domainId: string,
    localPart: string,
  ): Promise<Address | null> {
    return (
      [...this.rows.values()].find(
        (row) =>
          row.domainId === domainId &&
          row.localPart === localPart.toLowerCase(),
      ) ?? null
    );
  }

  async list(filter: { domainId?: string } = {}): Promise<AddressWithDomain[]> {
    const result: AddressWithDomain[] = [];

    for (const address of this.rows.values()) {
      if (filter.domainId && address.domainId !== filter.domainId) continue;

      const domain = await this.domains.findById(address.domainId);
      if (domain) result.push(this.withDomain(address, domain.name));
    }

    return result;
  }

  async update(id: string, data: UpdateAddressData): Promise<Address> {
    const existing = this.rows.get(id);
    if (!existing) throw new NotFoundError(`Address ${id} not found`);

    const updated: Address = { ...existing, ...data, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.rows.delete(id)) throw new NotFoundError(`Address ${id} not found`);
  }

  private withDomain(address: Address, domainName: string): AddressWithDomain {
    return {
      ...address,
      domainName,
      email: `${address.localPart}@${domainName}`,
    };
  }
}
