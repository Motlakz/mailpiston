import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '@/server/core/errors';
import { newId } from '@/server/core/ids';
import type {
  Endpoint,
  EndpointEmailRecipient,
  EndpointWebhookConfig,
} from '@/server/core/types';
import { db } from '@/server/db/client';
import {
  addressEndpoints,
  endpointEmailRecipients,
  endpointWebhookConfigs,
  endpoints,
} from '@/server/db/schema';
import type { EndpointRepository } from '@/server/repositories/types';

import { isUniqueViolation } from './domain-repository';

type EndpointRow = typeof endpoints.$inferSelect;
type RecipientRow = typeof endpointEmailRecipients.$inferSelect;

export class NeonEndpointRepository implements EndpointRepository {
  async create(data: {
    name: string;
    type: Endpoint['type'];
    enabled: boolean;
  }): Promise<Endpoint> {
    const [row] = await db
      .insert(endpoints)
      .values({ id: newId('endpoint'), ...data })
      .returning();

    return toEndpoint(row);
  }

  async findById(id: string): Promise<Endpoint | null> {
    const [row] = await db
      .select()
      .from(endpoints)
      .where(eq(endpoints.id, id))
      .limit(1);

    return row ? toEndpoint(row) : null;
  }

  async list(): Promise<Endpoint[]> {
    const rows = await db.select().from(endpoints).orderBy(asc(endpoints.name));
    return rows.map(toEndpoint);
  }

  async update(
    id: string,
    data: { name?: string; enabled?: boolean },
  ): Promise<Endpoint> {
    const [row] = await db
      .update(endpoints)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(endpoints.id, id))
      .returning();

    if (!row) throw new NotFoundError(`Endpoint ${id} not found`);
    return toEndpoint(row);
  }

  async delete(id: string): Promise<void> {
    const deleted = await db
      .delete(endpoints)
      .where(eq(endpoints.id, id))
      .returning({ id: endpoints.id });

    if (deleted.length === 0) throw new NotFoundError(`Endpoint ${id} not found`);
  }

  /**
   * Fan-out lookup. Disabled endpoints are filtered here rather than at the
   * call site: "enabled" is the whole point of the flag, and a caller that
   * forgets the check delivers mail the operator switched off.
   */
  async listForAddress(addressId: string): Promise<Endpoint[]> {
    const rows = await db
      .select({ endpoint: endpoints })
      .from(addressEndpoints)
      .innerJoin(endpoints, eq(addressEndpoints.endpointId, endpoints.id))
      .where(
        and(eq(addressEndpoints.addressId, addressId), eq(endpoints.enabled, true)),
      )
      .orderBy(asc(endpoints.name));

    return rows.map((row) => toEndpoint(row.endpoint));
  }

  async bindToAddress(addressId: string, endpointId: string): Promise<void> {
    await db
      .insert(addressEndpoints)
      .values({ addressId, endpointId })
      // Binding twice is the same fact, not an error.
      .onConflictDoNothing();
  }

  async unbindFromAddress(addressId: string, endpointId: string): Promise<void> {
    await db
      .delete(addressEndpoints)
      .where(
        and(
          eq(addressEndpoints.addressId, addressId),
          eq(addressEndpoints.endpointId, endpointId),
        ),
      );
  }

  async getWebhookConfig(
    endpointId: string,
  ): Promise<EndpointWebhookConfig | null> {
    const [row] = await db
      .select()
      .from(endpointWebhookConfigs)
      .where(eq(endpointWebhookConfigs.endpointId, endpointId))
      .limit(1);

    return row ?? null;
  }

  async setWebhookConfig(config: EndpointWebhookConfig): Promise<void> {
    await db
      .insert(endpointWebhookConfigs)
      .values(config)
      .onConflictDoUpdate({
        target: endpointWebhookConfigs.endpointId,
        set: { url: config.url, secretCiphertext: config.secretCiphertext },
      });
  }

  async listRecipients(endpointId: string): Promise<EndpointEmailRecipient[]> {
    const rows = await db
      .select()
      .from(endpointEmailRecipients)
      .where(eq(endpointEmailRecipients.endpointId, endpointId))
      .orderBy(asc(endpointEmailRecipients.createdAt));

    return rows.map(toRecipient);
  }

  async findRecipient(id: string): Promise<EndpointEmailRecipient | null> {
    const [row] = await db
      .select()
      .from(endpointEmailRecipients)
      .where(eq(endpointEmailRecipients.id, id))
      .limit(1);

    return row ? toRecipient(row) : null;
  }

  async addRecipient(
    endpointId: string,
    email: string,
  ): Promise<EndpointEmailRecipient> {
    try {
      const [row] = await db
        .insert(endpointEmailRecipients)
        .values({
          id: newId('recipient'),
          endpointId,
          email: email.toLowerCase(),
        })
        .returning();

      return toRecipient(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`${email} is already a recipient of this endpoint`);
      }
      throw error;
    }
  }

  /** Issues a challenge: the token is hashed here and never stored in clear. */
  async setRecipientChallenge(
    recipientId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await db
      .update(endpointEmailRecipients)
      .set({ verificationTokenHash: tokenHash, verificationExpiresAt: expiresAt })
      .where(eq(endpointEmailRecipients.id, recipientId));
  }

  /**
   * Consumes the challenge and marks the recipient verified.
   *
   * The token hash and expiry are part of the `WHERE`, so a stale or wrong
   * token updates nothing and the caller sees a plain "no" — there is no branch
   * that could verify a recipient on a failed comparison.
   */
  async verifyRecipientWithToken(
    recipientId: string,
    tokenHash: string,
    now: Date,
  ): Promise<EndpointEmailRecipient | null> {
    const [row] = await db
      .update(endpointEmailRecipients)
      .set({
        verifiedAt: now,
        verificationTokenHash: null,
        verificationExpiresAt: null,
      })
      .where(
        and(
          eq(endpointEmailRecipients.id, recipientId),
          eq(endpointEmailRecipients.verificationTokenHash, tokenHash),
          sql`${endpointEmailRecipients.verificationExpiresAt} > ${now.toISOString()}::timestamptz`,
        ),
      )
      .returning();

    return row ? toRecipient(row) : null;
  }

  async markRecipientVerified(
    recipientId: string,
  ): Promise<EndpointEmailRecipient> {
    const [row] = await db
      .update(endpointEmailRecipients)
      .set({
        verifiedAt: new Date(),
        verificationTokenHash: null,
        verificationExpiresAt: null,
      })
      .where(eq(endpointEmailRecipients.id, recipientId))
      .returning();

    if (!row) throw new NotFoundError(`Recipient ${recipientId} not found`);
    return toRecipient(row);
  }

  async removeRecipient(recipientId: string): Promise<void> {
    const deleted = await db
      .delete(endpointEmailRecipients)
      .where(eq(endpointEmailRecipients.id, recipientId))
      .returning({ id: endpointEmailRecipients.id });

    if (deleted.length === 0) {
      throw new NotFoundError(`Recipient ${recipientId} not found`);
    }
  }
}

function toEndpoint(row: EndpointRow): Endpoint {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRecipient(row: RecipientRow): EndpointEmailRecipient {
  return {
    id: row.id,
    endpointId: row.endpointId,
    email: row.email,
    verifiedAt: row.verifiedAt,
    verificationExpiresAt: row.verificationExpiresAt,
    enabled: row.enabled,
  };
}
