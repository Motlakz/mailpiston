import 'server-only';

import { asc, eq, sql } from 'drizzle-orm';

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
  async create(data: CreateDomainData): Promise<Domain> {
    try {
      const [row] = await db
        .insert(domains)
        .values({
          id: newId('domain'),
          name: data.name.toLowerCase(),
          providerDomainId: data.providerDomainId,
          status: data.status,
          dnsRecords: data.dnsRecords,
        })
        .returning();

      return toDomain(row);
    } catch (error) {
      // The unique index is on lower(name), so this is the only way a duplicate
      // can surface. Translate it rather than letting a driver error become a 500.
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Domain ${data.name} already exists`);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Domain | null> {
    const [row] = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async findByName(name: string): Promise<Domain | null> {
    const [row] = await db
      .select()
      .from(domains)
      .where(sql`lower(${domains.name}) = ${name.toLowerCase()}`)
      .limit(1);

    return row ? toDomain(row) : null;
  }

  async list(): Promise<Domain[]> {
    const rows = await db.select().from(domains).orderBy(asc(domains.name));
    return rows.map(toDomain);
  }

  async update(id: string, data: UpdateDomainData): Promise<Domain> {
    const [row] = await db
      .update(domains)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(domains.id, id))
      .returning();

    if (!row) throw new NotFoundError(`Domain ${id} not found`);
    return toDomain(row);
  }

  async delete(id: string): Promise<void> {
    const deleted = await db.delete(domains).where(eq(domains.id, id)).returning({
      id: domains.id,
    });

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
    dnsRecords: (row.dnsRecords ?? []) as DomainDnsRecord[],
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
