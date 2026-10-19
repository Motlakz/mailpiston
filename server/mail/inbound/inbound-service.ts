import 'server-only';

import { relayLocalToken } from '@/server/core/config';
import { createInboundFingerprint } from '@/server/core/idempotency';
import { newId } from '@/server/core/ids';
import type { AddressWithDomain } from '@/server/core/types';
import {
  addressOf,
  classify,
  matchesList,
  type Classification,
} from '@/server/mail/filtering/classifier';
import type { SenderPolicyService } from '@/server/mail/filtering/sender-policy-service';
import type { ForwardingService } from '@/server/mail/forwarding/forwarding-service';
import type { RelayService } from '@/server/mail/forwarding/relay-service';
import type { ThreadResolver } from '@/server/mail/threads/thread-resolver';
import type { WebhookService } from '@/server/mail/webhooks/webhook-service';
import type { NormalizedInboundEmail } from '@/server/providers/types';
import type {
  AddressRepository,
  CreateAttachmentData,
  EmailRepository,
  EventRepository,
  InboundThreadTarget,
  MailFilterRepository,
} from '@/server/repositories/types';
import type { Storage } from '@/server/storage';
import { attachmentKey, rawMimeKey } from '@/server/storage';

/**
 * The Phase 4 pipeline (roadmap Phase 4, plan §11).
 *
 *   normalize (done by the provider)
 *     → resolve recipient
 *         ├─ unknown local part → 'email.rejected' event, stop
 *         ├─ sender on the deny list → 'email.rejected' event, stop
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
  status: 'captured' | 'duplicate' | 'rejected' | 'relayed' | 'quarantined';
  emailId: string | null;
  reason?: string;
}

/** The fan-outs that run after capture. All optional wiring. */
export interface InboundHandlers {
  /** Replies arriving from a verified personal inbox (plan §19.2). */
  relay?: RelayService;
  /** Notifications out to verified personal inboxes (plan §19.1). */
  forwarding?: ForwardingService;
  /** Signed deliveries to HTTP endpoints (plan §13). */
  webhooks?: WebhookService;
  /**
   * The operator's standing allow and deny decisions (roadmap Phase 12).
   *
   * Optional: with no source of lists the classifier still runs on its rules
   * alone. Unwired, filtering degrades to "no explicit decisions yet", which is
   * the correct behaviour for a fresh deployment anyway.
   */
  filters?: MailFilterRepository;
  /**
   * Turns a sender whose flagged mail went unreviewed for too long into a
   * standing block, checked as they write again. Optional for the same reason
   * as `filters`.
   */
  senders?: Pick<SenderPolicyService, 'blockIfPersistent'>;
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
    // Provider ids change on every hop, so ordinary fingerprint deduplication
    // cannot stop a self-forwarding loop. Our marker can and must stop it
    // before storage or any outbound fan-out occurs.
    if (hasHeader(normalized.headers, 'x-mailpiston-forward')) {
      return this.reject(normalized, 'mailpiston_forward_loop');
    }

    // Relay mail is an instruction, not a message: it is a reply from a
    // verified personal inbox, and it is never stored as inbound customer mail.
    if (this.handlers.relay && relayLocalToken(normalized.recipient)) {
      const relayed = await this.handlers.relay.handle(normalized);

      if (relayed.status === 'relayed') {
        return { status: 'relayed', emailId: relayed.emailId };
      }
      if (relayed.status === 'duplicate') {
        return { status: 'duplicate', emailId: null, reason: relayed.reason };
      }
      return { status: 'rejected', emailId: null, reason: relayed.reason };
    }

    const address = await this.addresses.findByEmail(normalized.recipient);

    if (!address || !address.enabled) {
      return this.reject(
        normalized,
        address ? 'address_disabled' : 'unknown_recipient',
      );
    }

    const lists = await this.readLists();
    const blockedBy = blockingEntry(normalized, lists);

    if (blockedBy) {
      return this.reject(normalized, 'sender_blocked', { pattern: blockedBy });
    }

    const autoBlocked = await this.blockIfPersistent(normalized, lists);

    if (autoBlocked) {
      return this.reject(normalized, 'sender_blocked', {
        pattern: autoBlocked,
        automatic: true,
      });
    }

    // The id is minted here rather than by the repository because storage keys
    // embed it, and the bytes go up before the row goes in.
    const emailId = newId('email');

    const attachments = await this.storeAttachments(emailId, normalized);
    const rawStorageKey = await this.storeRawMime(emailId, normalized);
    const thread = await this.resolveThread(normalized);
    const classification = this.classify(normalized, thread, lists);

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
        spamVerdict: classification.verdict,
        spamScore: classification.score,
        spamCategory: classification.category,
        spamSignals: classification.signals,
      },
      attachments,
      thread,
      eventMetadata: {
        provider: normalized.provider,
        recipient: normalized.recipient,
        envelopeSender: normalized.envelopeSender,
        envelopeRecipients: normalized.envelopeRecipients,
        attachmentCount: attachments.length,
        spamVerdict: classification.verdict,
      },
    });

    if (result.duplicate) {
      return { status: 'duplicate', emailId: null };
    }

    /**
     * Quarantine stops the fan-out, and that is the whole of what it does.
     *
     * The message is already durable above — quarantine never decides whether
     * to store, only whether to *act*. Suppressing the fan-out is the part the
     * operator actually feels: their application is not woken for an SEO pitch
     * and their personal inbox does not receive a phishing attempt. Everything
     * is still on the Spam view, one click from being released.
     */
    if (classification.verdict === 'spam') {
      await this.events.create({
        emailId: result.email.id,
        type: 'email.quarantined',
        metadata: {
          recipient: normalized.recipient,
          from: normalized.from,
          category: classification.category,
          score: classification.score,
          signals: classification.signals,
        },
      });

      return { status: 'quarantined', emailId: result.email.id };
    }

    // Fan-out runs after the message is durable and can never undo it: a
    // personal mailbox or a customer's application being unreachable must not
    // turn into a provider retry that then deduplicates, leaving the operator
    // with no mail at all. Each destination is isolated from the others for the
    // same reason — one failing endpoint must not cost the rest their delivery.
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

    if (this.handlers.webhooks) {
      try {
        await this.handlers.webhooks.dispatch({
          email: result.email,
          address,
          event: result.event,
        });
      } catch (error) {
        console.error('Webhook dispatch failed', error);
      }
    }

    return { status: 'captured', emailId: result.email.id };
  }

  /**
   * The abuse verdict for this delivery (roadmap Phase 12).
   *
   * Two things are supplied that the rule engine cannot work out for itself.
   *
   * The operator's allow and deny lists, which override everything — a rule
   * engine that can out-vote an explicit decision is one the operator has to
   * fight.
   *
   * And whether this message joins a conversation we already hold. That is the
   * single most useful signal available and it is free here: thread resolution
   * has already run, and an existing thread means we have talked to this person
   * before. It discounts rather than exempts — a compromised account replying
   * in-thread is exactly how a convincing attack arrives.
   *
   */
  private classify(
    normalized: NormalizedInboundEmail,
    thread: InboundThreadTarget,
    lists: SenderLists,
  ): Classification {
    return classify({
      from: normalized.from,
      envelopeSender: normalized.envelopeSender,
      subject: normalized.subject,
      text: normalized.text,
      html: normalized.html,
      headers: normalized.headers,
      attachments: normalized.attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
      })),
      inReplyTo: normalized.inReplyTo,
      allowList: lists.allow,
      denyList: lists.deny,
      knownCorrespondent: thread.existingId !== undefined,
    });
  }

  /**
   * The operator's allow and deny lists, read once per delivery.
   *
   * A failure to read them must not cost the message: with no lists, nothing
   * is blocked and the rules classify on their own. Blocking and
   * classification are conveniences; capture is the product.
   */
  private async readLists(): Promise<SenderLists> {
    if (!this.handlers.filters) return { allow: [], deny: [] };

    try {
      return await this.handlers.filters.lists();
    } catch (error) {
      console.error('Could not read mail filter lists; capturing without them', error);
      return { allow: [], deny: [] };
    }
  }

  /** Same contract as `readLists`: a failure here never costs the message. */
  private async blockIfPersistent(
    normalized: NormalizedInboundEmail,
    lists: SenderLists,
  ): Promise<string | null> {
    if (!this.handlers.senders) return null;

    try {
      return await this.handlers.senders.blockIfPersistent(
        normalized.from,
        lists.allow,
      );
    } catch (error) {
      console.error('Could not check for a persistent sender; capturing anyway', error);
      return null;
    }
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
    detail: Record<string, unknown> = {},
  ): Promise<InboundResult> {
    await this.events.create({
      emailId: null,
      type: 'email.rejected',
      metadata: {
        ...detail,
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

type SenderLists = { allow: string[]; deny: string[] };

/**
 * The deny-list entry that refuses this delivery, or null.
 *
 * A blocked sender is refused at the door, like an unknown recipient: nothing
 * is stored, nothing is fanned out, and the `email.rejected` event is the whole
 * trace. That is a deliberate exception to "quarantine, never drop", and it is
 * only safe because a deny entry is a decision somebody made about a sender —
 * by hand, or by the sweep after days of that sender's mail going unclaimed —
 * never a verdict on one message's content.
 *
 * The envelope sender is checked as well as `From:`, so rotating the display
 * address over the same sending account does not get round a block. An allow
 * entry for the `From:` address still wins: "block focusapps.app, but not
 * the founder I actually talk to" has to be expressible.
 */
function blockingEntry(
  normalized: NormalizedInboundEmail,
  lists: SenderLists,
): string | null {
  if (lists.deny.length === 0) return null;

  const sender = addressOf(normalized.from);
  if (matchesList(sender, lists.allow)) return null;

  const envelope = normalized.envelopeSender?.toLowerCase() ?? null;

  return (
    lists.deny.find(
      (pattern) =>
        matchesList(sender, [pattern]) ||
        (envelope !== null && matchesList(envelope, [pattern])),
    ) ?? null
  );
}

function hasHeader(
  headers: Record<string, string | string[]>,
  expectedName: string,
): boolean {
  return Object.keys(headers).some(
    (name) => name.toLowerCase() === expectedName.toLowerCase(),
  );
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
