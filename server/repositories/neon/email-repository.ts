import 'server-only';

import { and, desc, eq, lt, sql } from 'drizzle-orm';

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
import { addresses, domains, emailAttachments, emails, mailEvents } from '@/server/db/schema';
import type {
  CreateAttachmentData,
  CreateEmailData,
  EmailRepository,
  InboundCaptureResult,
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
  }): Promise<InboundCaptureResult> {
    try {
      return await db.transaction(async (tx) => {
        const [emailRow] = await tx
          .insert(emails)
          .values(input.email)
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

  async list(filter: {
    direction?: Email['direction'];
    addressId?: string;
    threadId?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<Paginated<EmailListItem>> {
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
          filter.addressId ? eq(emails.addressId, filter.addressId) : undefined,
          filter.threadId ? eq(emails.threadId, filter.threadId) : undefined,
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
    createdAt: row.createdAt,
  };
}
