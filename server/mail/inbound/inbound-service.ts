import 'server-only';

import { isRelayRecipient } from '@/server/core/config';
import { createInboundFingerprint } from '@/server/core/idempotency';
import { newId } from '@/server/core/ids';
import type { AddressWithDomain } from '@/server/core/types';
import type { ForwardingService } from '@/server/mail/forwarding/forwarding-service';
import type { RelayService } from '@/server/mail/forwarding/relay-service';
import type { ThreadResolver } from '@/server/mail/threads/thread-resolver';
import type { NormalizedInboundEmail } from '@/server/providers/types';
import type {
  AddressRepository,
  CreateAttachmentData,
  EmailRepository,
  EventRepository,
  InboundThreadTarget,
} from '@/server/repositories/types';
import type { Storage } from '@/server/storage';
import { attachmentKey, rawMimeKey } from '@/server/storage';

/**
 * The Phase 4 pipeline (roadmap Phase 4, plan §11).
 *
 *   normalize (done by the provider)
 *     → resolve recipient
 *         ├─ unknown local part → 'email.rejected' event, stop
 *         └─ known → store bytes → resolve thread
 *                      → atomic insert (thread + message + attachments + event)
 *                      ├─ fingerprint already present → duplicate, stop
 *                      └─ inserted → captured
 *
 * Two things about this order are deliberate and easy to get wrong.
 *
 * **The catch-all does not accept unknown local parts.** It is a transport
 * mechanism that gets mail for *any* local part to our ingress, so that an
 * inbound-only address can exist without its own provider alias (Phase 3). It
 * is not permission to invent addresses: a message for a local part with no
 * `addresses` row is recorded as `email.rejected` and dropped. Doing otherwise
 * would turn every typo and every dictionary spam run into a durable row.
 *
 * **Bytes are written before the row, not after.** The storage write is a
 * network call and cannot join the transaction. Writing it first means the
 * worst case is an orphaned object — cheap, invisible, collectable. Writing it
 * second would mean a committed attachment row pointing at a key that does not
 * exist, which is indistinguishable from data loss at read time.
 */
export interface InboundResult {
  status: 'captured' | 'duplicate' | 'rejected' | 'relayed';
  emailId: string | null;
  reason?: string;
}

/** The two fan-outs that run after capture. Both are optional wiring. */
export interface InboundHandlers {
  /** Replies arriving from a verified personal inbox (plan §19.2). */
  relay?: RelayService;
  /** Notifications out to verified personal inboxes (plan §19.1). */
  forwarding?: ForwardingService;
}

export class InboundService {
  private readonly resolveStorage: () => Storage;

  constructor(
    private readonly emails: EmailRepository,
    private readonly addresses: AddressRepository,
    private readonly events: EventRepository,
    private readonly threads: ThreadResolver,
    storage: Storage | (() => Storage),
    private readonly options: { storeRawMime: boolean },
    private readonly handlers: InboundHandlers = {},
  ) {
    this.resolveStorage = typeof storage === 'function' ? storage : () => storage;
  }

  async capture(normalized: NormalizedInboundEmail): Promise<InboundResult> {
    // Relay mail is an instruction, not a message: it is a reply from a
    // verified personal inbox, and it is never stored as inbound customer mail.
    if (this.handlers.relay && isRelayRecipient(normalized.recipient)) {
      const relayed = await this.handlers.relay.handle(normalized);

      return relayed.status === 'relayed'
        ? { status: 'relayed', emailId: relayed.emailId }
        : { status: 'rejected', emailId: null, reason: relayed.reason };
    }

    const address = await this.addresses.findByEmail(normalized.recipient);

    if (!address || !address.enabled) {
      return this.reject(
        normalized,
        address ? 'address_disabled' : 'unknown_recipient',
      );
    }

    // The id is minted here rather than by the repository because storage keys
    // embed it, and the bytes go up before the row goes in.
    const emailId = newId('email');

    const attachments = await this.storeAttachments(emailId, normalized);
    const rawStorageKey = await this.storeRawMime(emailId, normalized);
    const thread = await this.resolveThread(normalized);

    const result = await this.emails.createInbound({
      email: {
        id: emailId,
        // Overwritten inside the capture transaction from `thread` below,
        // which is where the thread row is created or joined.
        threadId: null,
        addressId: address.id,
        providerMessageId: normalized.providerMessageId,
        messageId: normalized.messageId,
        fingerprint: fingerprintFor(normalized, address),
        direction: 'inbound',
        status: 'received',
        from: normalized.from,
        to: normalized.to,
        cc: normalized.cc,
        subject: normalized.subject,
        text: normalized.text,
        html: normalized.html,
        inReplyTo: normalized.inReplyTo,
        references: normalized.references,
        rawStorageKey,
        receivedAt: normalized.receivedAt,
        sentAt: null,
      },
      attachments,
      thread,
      eventMetadata: {
        provider: normalized.provider,
        recipient: normalized.recipient,
        envelopeSender: normalized.envelopeSender,
        envelopeRecipients: normalized.envelopeRecipients,
        attachmentCount: attachments.length,
      },
    });

    if (result.duplicate) {
      return { status: 'duplicate', emailId: null };
    }

    // Fan-out runs after the message is durable and can never undo it: a
    // personal mailbox being unreachable must not turn into a provider retry
    // that then deduplicates, leaving the operator with no mail at all.
    if (this.handlers.forwarding) {
      try {
        await this.handlers.forwarding.forward({
          email: result.email,
          address,
        });
      } catch (error) {
        console.error('Personal forwarding failed', error);
      }
    }

    return { status: 'captured', emailId: result.email.id };
  }

  /**
   * Which conversation this message joins, or a new one.
   *
   * Read before the write and passed in, because the resolver reads existing
   * messages while the thread row itself must be created inside the capture
   * transaction — a message that turns out to be a duplicate must not leave an
   * empty thread behind.
   */
  private async resolveThread(
    normalized: NormalizedInboundEmail,
  ): Promise<InboundThreadTarget> {
    const existing = await this.threads.resolve({
      inReplyTo: normalized.inReplyTo,
      references: normalized.references,
    });

    return existing
      ? { existingId: existing.id }
      : { subject: normalized.subject };
  }

  /**
   * Mail we cannot route is recorded and dropped, never bounced.
   *
   * Bouncing would tell a spam run which local parts exist and would send mail
   * on the operator's behalf to an address that has proven nothing. The event
   * is the whole point: an operator who expected a message and cannot find it
   * needs to see *why*, and "no such address" is the answer more often than
   * anything else.
   */
  private async reject(
    normalized: NormalizedInboundEmail,
    reason: string,
  ): Promise<InboundResult> {
    await this.events.create({
      emailId: null,
      type: 'email.rejected',
      metadata: {
        reason,
        provider: normalized.provider,
        recipient: normalized.recipient,
        envelopeSender: normalized.envelopeSender,
        from: normalized.from,
        subject: normalized.subject,
        messageId: normalized.messageId,
      },
    });

    return { status: 'rejected', emailId: null, reason };
  }

  private async storeAttachments(
    emailId: string,
    normalized: NormalizedInboundEmail,
  ): Promise<CreateAttachmentData[]> {
    const stored: CreateAttachmentData[] = [];

    for (const attachment of normalized.attachments) {
      const bytes = Buffer.from(attachment.content, 'base64');
      const key = attachmentKey(emailId, newId('attachment'));

      await this.resolveStorage().put(key, bytes, {
        contentType: attachment.contentType,
        filename: attachment.filename,
      });

      stored.push({
        filename: attachment.filename,
        contentType: attachment.contentType,
        // The provider's declared size and the decoded length can disagree.
        // The decoded length is what a download will actually produce.
        sizeBytes: bytes.byteLength,
        storageKey: key,
      });
    }

    return stored;
  }

  private async storeRawMime(
    emailId: string,
    normalized: NormalizedInboundEmail,
  ): Promise<string | null> {
    if (!this.options.storeRawMime || !normalized.raw) return null;

    const key = rawMimeKey(emailId);
    await this.resolveStorage().put(key, Buffer.from(normalized.raw, 'utf8'), {
      contentType: 'message/rfc822',
      filename: `${emailId}.eml`,
    });

    return key;
  }
}

/**
 * §10.1, extended with the resolved address id.
 *
 * A message sent to two of our managed addresses arrives as two separate
 * provider deliveries carrying the same `Message-ID`. Without the address in
 * the key, the second delivery deduplicates against the first and one of the
 * two mailboxes silently never receives it.
 */
function fingerprintFor(
  normalized: NormalizedInboundEmail,
  address: AddressWithDomain,
): string {
  return createInboundFingerprint({
    provider: normalized.provider,
    providerMessageId: normalized.providerMessageId,
    messageId: normalized.messageId,
    recipient: normalized.recipient,
    addressId: address.id,
    // Only consulted when the delivery carries no id at all. Raw MIME is the
    // most faithful thing we have; the header/body triple is the fallback for
    // providers that do not send it.
    contentFallback:
      normalized.raw ??
      [
        normalized.envelopeSender ?? '',
        normalized.from,
        normalized.subject ?? '',
        normalized.receivedAt.toISOString(),
        normalized.text ?? normalized.html ?? '',
      ].join(' '),
  });
}
