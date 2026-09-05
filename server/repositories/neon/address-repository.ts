import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '@/server/core/errors';
import { newId } from '@/server/core/ids';
import type { Address, AddressWithDomain } from '@/server/core/types';
import { db } from '@/server/db/client';
import { addresses, domains } from '@/server/db/schema';
import type {
  AddressRepository,
  CreateAddressData,
  UpdateAddressData,
} from '@/server/repositories/types';

import { isUniqueViolation } from './domain-repository';

type AddressRow = typeof addresses.$inferSelect;

export class NeonAddressRepository implements AddressRepository {
  async create(data: CreateAddressData): Promise<Address> {
    try {
      const [row] = await db
        .insert(addresses)
        .values({
          id: newId('address'),
          domainId: data.domainId,
          localPart: data.localPart.toLowerCase(),
          providerAliasId: data.providerAliasId,
          canSend: data.canSend,
          enabled: data.enabled,
        })
        .returning();

      return toAddress(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          `Address ${data.localPart} already exists on that domain`,
        );
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Address | null> {
    const [row] = await db.select().from(addresses).where(eq(addresses.id, id)).limit(1);
    return row ? toAddress(row) : null;
  }

  /**
   * The inbound routing lookup. Both sides are lower-cased because an envelope
   * recipient arrives in whatever case the sender typed, and the unique index
   * is on `lower(local_part)`.
   */
  async findByEmail(email: string): Promise<AddressWithDomain | null> {
    const at = email.lastIndexOf('@');
    if (at <= 0) return null;

    const localPart = email.slice(0, at).toLowerCase();
    const domainName = email.slice(at + 1).toLowerCase();

    const [row] = await db
      .select({ address: addresses, domainName: domains.name })
      .from(addresses)
      .innerJoin(domains, eq(addresses.domainId, domains.id))
      .where(
        and(
          sql`lower(${addresses.localPart}) = ${localPart}`,
          sql`lower(${domains.name}) = ${domainName}`,
        ),
      )
      .limit(1);

    return row ? withDomain(row.address, row.domainName) : null;
  }

  async findByDomainAndLocalPart(
    domainId: string,
    localPart: string,
  ): Promise<Address | null> {
    const [row] = await db
      .select()
      .from(addresses)
      .where(
        and(
          eq(addresses.domainId, domainId),
          sql`lower(${addresses.localPart}) = ${localPart.toLowerCase()}`,
        ),
      )
      .limit(1);

    return row ? toAddress(row) : null;
  }

  async list(filter: { domainId?: string } = {}): Promise<AddressWithDomain[]> {
    const rows = await db
      .select({ address: addresses, domainName: domains.name })
      .from(addresses)
      .innerJoin(domains, eq(addresses.domainId, domains.id))
      .where(filter.domainId ? eq(addresses.domainId, filter.domainId) : undefined)
      .orderBy(asc(domains.name), asc(addresses.localPart));

    return rows.map((row) => withDomain(row.address, row.domainName));
  }

  async update(id: string, data: UpdateAddressData): Promise<Address> {
    const [row] = await db
      .update(addresses)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(addresses.id, id))
      .returning();

    if (!row) throw new NotFoundError(`Address ${id} not found`);
    return toAddress(row);
  }

  async delete(id: string): Promise<void> {
    const deleted = await db
      .delete(addresses)
      .where(eq(addresses.id, id))
      .returning({ id: addresses.id });

    if (deleted.length === 0) throw new NotFoundError(`Address ${id} not found`);
  }
}

function toAddress(row: AddressRow): Address {
  return {
    id: row.id,
    domainId: row.domainId,
    localPart: row.localPart,
    providerAliasId: row.providerAliasId,
    canSend: row.canSend,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function withDomain(row: AddressRow, domainName: string): AddressWithDomain {
  return {
    ...toAddress(row),
    domainName,
    email: `${row.localPart}@${domainName}`,
  };
}
