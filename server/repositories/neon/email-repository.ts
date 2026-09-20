import 'server-only';

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from 'drizzle-orm';

import { NotFoundError } from '@/server/core/errors';
import { newId } from '@/server/core/ids';
import type {
  Email,
  EmailAttachment,
  EmailListItem,
  MailEvent,
  Paginated,
} from '@/server/core/types';
import { db } from '@/server/db/client';
import {
  addresses,
  domains,
  emailAttachments,
  emails,
  mailEvents,
  threads,
} from '@/server/db/schema';
import type {
  CreateAttachmentData,
  CreateEmailData,
  EmailFilter,
  EmailRepository,
  InboundCaptureResult,
  InboundThreadTarget,
} from '@/server/repositories/types';

import { isUniqueViolation } from './domain-repository';

type EmailRow = typeof emails.$inferSelect;
type AttachmentRow = typeof emailAttachments.$inferSelect;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class NeonEmailRepository implements EmailRepository {
  async create(data: CreateEmailData): Promise<Email> {
    const [row] = await db
      .insert(emails)
      .values({ id: newId('email'), ...data })
      .returning();

    return toEmail(row);
  }

  /**
   * The Phase 4 write.
   *
   * One transaction covering the message, its attachment metadata, and its
   * `email.received` event. The unique index on `fingerprint` is the
   * idempotency mechanism: a re-delivered message raises a unique violation on
   * the very first statement, the transaction rolls back untouched, and the
   * caller reports `duplicate` rather than an error.
   */
  async createInbound(input: {
    email: CreateEmailData & { id: string; fingerprint: string };
    attachments: CreateAttachmentData[];
    eventMetadata: Record<string, unknown>;
    thread: InboundThreadTarget;
  }): Promise<InboundCaptureResult> {
    try {
      return await db.transaction(async (tx) => {
        const threadId = await attachToThread(tx, input.thread, input.email);

        const [emailRow] = await tx
          .insert(emails)
          .values({ ...input.email, threadId })
          .returning();

        if (input.attachments.length > 0) {
          await tx.insert(emailAttachments).values(
            input.attachments.map((attachment) => ({
              id: newId('attachment'),
              emailId: emailRow.id,
              ...attachment,
            })),
          );
        }

        const [eventRow] = await tx
          .insert(mailEvents)
          .values({
            id: newId('event'),
            emailId: emailRow.id,
            type: 'email.received' as const,
            metadata: input.eventMetadata,
          })
          .returning();

        return {
          duplicate: false as const,
          email: toEmail(emailRow),
          event: {
            id: eventRow.id,
            emailId: eventRow.emailId,
            type: eventRow.type,
            metadata: (eventRow.metadata ?? {}) as Record<string, unknown>,
            occurredAt: eventRow.occurredAt,
          } satisfies MailEvent,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { duplicate: true, email: null, event: null };
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Email | null> {
    const [row] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
    return row ? toEmail(row) : null;
  }

  async findByMessageId(messageId: string): Promise<Email | null> {
    const [row] = await db
      .select()
      .from(emails)
      .where(eq(emails.messageId, messageId))
      .orderBy(desc(emails.createdAt))
      .limit(1);

    return row ? toEmail(row) : null;
  }

  async findByProviderMessageId(providerMessageId: string): Promise<Email | null> {
    const [row] = await db
      .select()
      .from(emails)
      .where(eq(emails.providerMessageId, providerMessageId))
      .orderBy(desc(emails.createdAt))
      .limit(1);

    return row ? toEmail(row) : null;
  }

  async list(filter: EmailFilter): Promise<Paginated<EmailListItem>> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Cursor is the ISO `created_at` of the last row seen, matching the event
    // log. An OFFSET would skip rows written while the operator pages.
    const cursorDate = filter.cursor ? new Date(filter.cursor) : null;

    const rows = await db
      .select({
        email: emails,
        localPart: addresses.localPart,
        domainName: domains.name,
        attachmentCount: sql<number>`(
          select count(*)::int from ${emailAttachments}
          where ${emailAttachments.emailId} = ${emails.id}
        )`,
      })
      .from(emails)
      .leftJoin(addresses, eq(emails.addressId, addresses.id))
      .leftJoin(domains, eq(addresses.domainId, domains.id))
      .where(
        and(
          filter.direction ? eq(emails.direction, filter.direction) : undefined,
          filter.statuses?.length
            ? inArray(emails.status, filter.statuses)
            : undefined,
          filter.addressId ? eq(emails.addressId, filter.addressId) : undefined,
          filter.threadId ? eq(emails.threadId, filter.threadId) : undefined,
          // Quarantined mail is opted into, never defaulted into: a caller that
          // forgets this filter should under-show rather than leak spam into
          // the ordinary views.
          inArray(
            emails.spamVerdict,
            filter.spamVerdicts?.length
              ? filter.spamVerdicts
              : (['clean', 'suspicious'] as const),
          ),
          filter.deleted
            ? isNotNull(emails.deletedAt)
            : isNull(emails.deletedAt),
          cursorDate ? lt(emails.createdAt, cursorDate) : undefined,
        ),
      )
      .orderBy(desc(emails.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      ...toEmail(row.email),
      addressEmail:
        row.localPart && row.domainName
          ? `${row.localPart}@${row.domainName}`
          : null,
      attachmentCount: row.attachmentCount,
    }));

    return {
      items,
      nextCursor: hasMore
        ? (items.at(-1)?.createdAt.toISOString() ?? null)
        : null,
    };
  }

  async updateStatus(id: string, status: Email['status']): Promise<Email> {
    const [row] = await db
      .update(emails)
      .set({ status, updatedAt: new Date() })
      .where(eq(emails.id, id))
      .returning();

    if (!row) throw new NotFoundError(`Email ${id} not found`);
    return toEmail(row);
  }

  async recordSent(
    id: string,
    data: {
      status: Email['status'];
      providerMessageId: string | null;
      messageId: string | null;
      sentAt: Date | null;
    },
  ): Promise<Email> {
    const [row] = await db
      .update(emails)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(emails.id, id))
      .returning();

    if (!row) throw new NotFoundError(`Email ${id} not found`);
    return toEmail(row);
  }

  async addAttachment(
    data: Omit<EmailAttachment, 'id' | 'createdAt'>,
  ): Promise<EmailAttachment> {
    const [row] = await db
      .insert(emailAttachments)
      .values({ id: newId('attachment'), ...data })
      .returning();

    return toAttachment(row);
  }

  async listAttachments(emailId: string): Promise<EmailAttachment[]> {
    const rows = await db
      .select()
      .from(emailAttachments)
      .where(eq(emailAttachments.emailId, emailId))
      .orderBy(emailAttachments.createdAt);

    return rows.map(toAttachment);
  }

  async findAttachment(id: string): Promise<EmailAttachment | null> {
    const [row] = await db
      .select()
      .from(emailAttachments)
      .where(eq(emailAttachments.id, id))
      .limit(1);

    return row ? toAttachment(row) : null;
  }

  // --- Retention (Phase 11) -------------------------------------------------

  async listPrunableRawMime(
    before: Date,
    limit: number,
  ): Promise<Array<{ id: string; rawStorageKey: string }>> {
    const rows = await db
      .select({ id: emails.id, rawStorageKey: emails.rawStorageKey })
      .from(emails)
      .where(
        and(isNotNull(emails.rawStorageKey), lt(emails.createdAt, before)),
      )
      .orderBy(asc(emails.createdAt))
      .limit(limit);

    return rows.filter(
      (row): row is { id: string; rawStorageKey: string } =>
        row.rawStorageKey !== null,
    );
  }

  async clearRawStorageKey(id: string): Promise<void> {
    await db
      .update(emails)
      .set({ rawStorageKey: null, updatedAt: new Date() })
      .where(eq(emails.id, id));
  }

  async listPrunableAttachments(
    before: Date,
    limit: number,
  ): Promise<EmailAttachment[]> {
    const rows = await db
      .select()
      .from(emailAttachments)
      .where(
        and(
          isNull(emailAttachments.prunedAt),
          lt(emailAttachments.createdAt, before),
        ),
      )
      .orderBy(asc(emailAttachments.createdAt))
      .limit(limit);

    return rows.map(toAttachment);
  }

  async markAttachmentPruned(id: string): Promise<void> {
    await db
      .update(emailAttachments)
      .set({ prunedAt: new Date() })
      .where(eq(emailAttachments.id, id));
  }

  // --- Classification and the bin (Phase 12) --------------------------------

  async setSpamVerdict(
    id: string,
    verdict: Email['spamVerdict'],
    signals: Email['spamSignals'],
  ): Promise<Email> {
    const [row] = await db
      .update(emails)
      .set({
        spamVerdict: verdict,
        spamSignals: signals,
        spamScore: signals.reduce((total, signal) => total + signal.score, 0),
        spamCategory: signals[0]?.category ?? null,
        updatedAt: new Date(),
      })
      .where(eq(emails.id, id))
      .returning();

    if (!row) throw new NotFoundError(`Email ${id} not found`);
    return toEmail(row);
  }

  async softDelete(id: string): Promise<Email> {
    const [row] = await db
      .update(emails)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(emails.id, id))
      .returning();

    if (!row) throw new NotFoundError(`Email ${id} not found`);
    return toEmail(row);
  }

  async restore(id: string): Promise<Email> {
    const [row] = await db
      .update(emails)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(emails.id, id))
      .returning();

    if (!row) throw new NotFoundError(`Email ${id} not found`);
    return toEmail(row);
  }

  /**
   * Emptying the bin. The only statement in the system that loses a message.
   *
   * The attachment rows cascade from the message, so the storage keys have to
   * be read *before* the delete or they are gone with it. They are returned
   * rather than acted on: this is a repository, and reaching into object
   * storage from here would put a network call inside a database method.
   */
  async purgeDeleted(
    before?: Date,
  ): Promise<{ count: number; storageKeys: string[] }> {
    const scope = and(
      isNotNull(emails.deletedAt),
      before ? lt(emails.deletedAt, before) : undefined,
    );

    const doomed = await db
      .select({ id: emails.id, rawStorageKey: emails.rawStorageKey })
      .from(emails)
      .where(scope);

    if (doomed.length === 0) return { count: 0, storageKeys: [] };

    const ids = doomed.map((row) => row.id);

    const attachments = await db
      .select({ storageKey: emailAttachments.storageKey })
      .from(emailAttachments)
      .where(inArray(emailAttachments.emailId, ids));

    await db.delete(emails).where(inArray(emails.id, ids));

    return {
      count: ids.length,
      storageKeys: [
        ...doomed.map((row) => row.rawStorageKey).filter((key): key is string => Boolean(key)),
        ...attachments.map((row) => row.storageKey),
      ],
    };
  }

  async purgeOne(id: string): Promise<{ storageKeys: string[] }> {
    const [row] = await db
      .select({ rawStorageKey: emails.rawStorageKey })
      .from(emails)
      .where(eq(emails.id, id))
      .limit(1);

    if (!row) throw new NotFoundError(`Email ${id} not found`);

    const attachments = await db
      .select({ storageKey: emailAttachments.storageKey })
      .from(emailAttachments)
      .where(eq(emailAttachments.emailId, id));

    await db.delete(emails).where(eq(emails.id, id));

    return {
      storageKeys: [
        ...(row.rawStorageKey ? [row.rawStorageKey] : []),
        ...attachments.map((attachment) => attachment.storageKey),
      ],
    };
  }
}

/**
 * Resolves the target into a thread id, creating the thread when the message
 * starts a new conversation.
 *
 * Inside the transaction on purpose: the email insert below can still raise a
 * duplicate-fingerprint violation, and a thread created outside it would
 * survive that rollback as an empty conversation in the operator's list.
 */
async function attachToThread(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  target: InboundThreadTarget,
  email: CreateEmailData,
): Promise<string> {
  const lastMessageAt = email.receivedAt ?? new Date();

  if (target.existingId !== undefined) {
    await tx
      .update(threads)
      .set({
        lastMessageAt: sql`greatest(${threads.lastMessageAt}, ${lastMessageAt.toISOString()}::timestamptz)`,
        updatedAt: new Date(),
      })
      .where(eq(threads.id, target.existingId));

    return target.existingId;
  }

  const [row] = await tx
    .insert(threads)
    .values({ id: newId('thread'), subject: target.subject, lastMessageAt })
    .returning({ id: threads.id });

  return row.id;
}

function toEmail(row: EmailRow): Email {
  return {
    id: row.id,
    threadId: row.threadId,
    addressId: row.addressId,
    providerMessageId: row.providerMessageId,
    messageId: row.messageId,
    fingerprint: row.fingerprint,
    direction: row.direction,
    status: row.status,
    from: row.from,
    to: row.to,
    cc: row.cc,
    subject: row.subject,
    text: row.text,
    html: row.html,
    inReplyTo: row.inReplyTo,
    references: row.references,
    rawStorageKey: row.rawStorageKey,
    receivedAt: row.receivedAt,
    sentAt: row.sentAt,
    spamVerdict: row.spamVerdict,
    spamScore: row.spamScore,
    spamCategory: row.spamCategory as Email['spamCategory'],
    spamSignals: (row.spamSignals ?? []) as Email['spamSignals'],
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAttachment(row: AttachmentRow): EmailAttachment {
  return {
    id: row.id,
    emailId: row.emailId,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    prunedAt: row.prunedAt,
    createdAt: row.createdAt,
  };
}
