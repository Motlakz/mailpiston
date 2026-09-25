import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { newId } from '@/server/core/ids';
import { ConflictError, NotFoundError } from '@/server/core/errors';
import type { Domain, DomainDnsRecord } from '@/server/core/types';
import { db } from '@/server/db/client';
import { domains } from '@/server/db/schema';
import type {
  CreateDomainData,
  DomainRepository,
  UpdateDomainData,
} from '@/server/repositories/types';

type DomainRow = typeof domains.$inferSelect;

export class NeonDomainRepository implements DomainRepository {
  /**
   * Bound to one tenant for the life of the instance.
   *
   * Every statement below carries the filter, so a caller cannot reach another
   * tenant's row even by passing a valid id belonging to one. That is the
   * whole point of scoping here rather than at the call sites: there are
   * twenty-seven of those and one of this.
   */
  constructor(private readonly tenantId: string) {}

  async create(data: CreateDomainData): Promise<Domain> {
    try {
      const [row] = await db
        .insert(domains)
        .values({
          id: newId('domain'),
          tenantId: this.tenantId,
          name: data.name.toLowerCase(),
          providerDomainId: data.providerDomainId,
          status: data.status,
          dnsRecords: data.dnsRecords,
        })
        .returning();

      return toDomain(row);
    } catch (error) {
      // The unique index is on (tenant_id, lower(name)), so this is the only
      // way a duplicate can surface — and it is per tenant, because two
      // workspaces may legitimately each hold the same domain. Translate it rather than letting a driver error become a 500.
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Domain ${data.name} already exists`);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Domain | null> {
    const [row] = await db
      .select()
      .from(domains)
      .where(and(eq(domains.tenantId, this.tenantId), eq(domains.id, id)))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async findByName(name: string): Promise<Domain | null> {
    const [row] = await db
      .select()
      .from(domains)
      .where(
        and(
          eq(domains.tenantId, this.tenantId),
          sql`lower(${domains.name}) = ${name.toLowerCase()}`,
        ),
      )
      .limit(1);

    return row ? toDomain(row) : null;
  }

  async list(): Promise<Domain[]> {
    const rows = await db
      .select()
      .from(domains)
      .where(eq(domains.tenantId, this.tenantId))
      .orderBy(asc(domains.name));
    return rows.map(toDomain);
  }

  async findRelayDomain(): Promise<Domain | null> {
    const [row] = await db
      .select()
      .from(domains)
      .where(
        and(
          eq(domains.tenantId, this.tenantId),
          eq(domains.relayEnabled, true),
        ),
      )
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async setRelayDomain(id: string, enabled: boolean): Promise<Domain> {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: domains.id })
        .from(domains)
        .where(and(eq(domains.tenantId, this.tenantId), eq(domains.id, id)))
        .limit(1);
      if (!existing) throw new NotFoundError(`Domain ${id} not found`);

      if (enabled) {
        await tx
          .update(domains)
          .set({ relayEnabled: false, updatedAt: new Date() })
          .where(eq(domains.tenantId, this.tenantId));
      }

      const [row] = await tx
        .update(domains)
        .set({ relayEnabled: enabled, updatedAt: new Date() })
        .where(and(eq(domains.tenantId, this.tenantId), eq(domains.id, id)))
        .returning();

      return toDomain(row);
    });
  }

  async update(id: string, data: UpdateDomainData): Promise<Domain> {
    const [row] = await db
      .update(domains)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(domains.tenantId, this.tenantId), eq(domains.id, id)))
      .returning();

    if (!row) throw new NotFoundError(`Domain ${id} not found`);
    return toDomain(row);
  }

  async delete(id: string): Promise<void> {
    const deleted = await db
      .delete(domains)
      .where(and(eq(domains.tenantId, this.tenantId), eq(domains.id, id)))
      .returning({ id: domains.id });

    if (deleted.length === 0) throw new NotFoundError(`Domain ${id} not found`);
  }
}

function toDomain(row: DomainRow): Domain {
  return {
    id: row.id,
    name: row.name,
    providerDomainId: row.providerDomainId,
    status: row.status,
    catchAllAliasId: row.catchAllAliasId,
    relayEnabled: row.relayEnabled,
    dnsRecords: (row.dnsRecords ?? []) as DomainDnsRecord[],
    verificationErrors: (row.verificationErrors ?? []) as string[],
    lastVerifiedAt: row.lastVerifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Postgres `unique_violation`. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
