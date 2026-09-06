import 'server-only';

import { ConflictError, NotFoundError, ValidationError } from '@/server/core/errors';
import type { Email } from '@/server/core/types';
import type { MailProvider } from '@/server/providers/types';
import type {
  AddressRepository,
  EmailRepository,
  EventRepository,
  ThreadRepository,
} from '@/server/repositories/types';

/**
 * Outbound mail (roadmap Phase 6, plan §6).
 *
 * Every send follows the same three steps, and the order is the point:
 *
 *   1. write the row as `queued` with an `email.queued` event;
 *   2. hand it to the provider;
 *   3. record what came back — `sent` with the provider's ids, or `failed`.
 *
 * The row goes in **before** the provider call for the same reason inbound
 * writes attachment bytes before the row: the step that can succeed while its
 * answer is lost must be the one we can reconcile afterwards. A send that
 * leaves no trace until the response arrives is invisible if the process dies
 * mid-flight — the mail went out and MailPiston has no idea. A row stuck in
 * `queued` is visible, explainable, and repairable.
 *
 * Sending requires a *concrete* provider alias. Forward Email will not
 * authorise a `From:` for an address that only exists behind a domain
 * catch-all (roadmap §5.6), so an inbound-only address is refused here rather
 * than at the provider, where the error would be someone else's vocabulary.
 */
export interface SendInput {
  addressId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface ReplyInput {
  text?: string;
  html?: string;
  /** Defaults to the sender of the message being answered. */
  to?: string[];
  cc?: string[];
}

export class OutboundService {
  constructor(
    private readonly emails: EmailRepository,
    private readonly addresses: AddressRepository,
    private readonly events: EventRepository,
    private readonly threads: ThreadRepository,
    private readonly provider: MailProvider,
  ) {}

  async send(input: SendInput): Promise<Email> {
    const from = await this.requireSendableAddress(input.addressId);

    const thread = await this.threads.create({
      subject: input.subject,
      lastMessageAt: new Date(),
    });

    const queued = await this.queue({
      threadId: thread.id,
      addressId: from.id,
      from: from.email,
      to: input.to,
      cc: input.cc ?? [],
      subject: input.subject,
      text: input.text ?? null,
      html: input.html ?? null,
      inReplyTo: null,
      references: [],
    });

    return this.dispatch(queued, () =>
      this.provider.send({
        from: from.email,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    );
  }

  /**
   * Answers an existing message in place.
   *
   * `In-Reply-To` and `References` are set from the parent so the *recipient's*
   * mail client threads it too. Threading only our own copy would be the easy
   * half and the useless one: the customer would see a disconnected message.
   */
  async reply(emailId: string, input: ReplyInput): Promise<Email> {
    const parent = await this.emails.findById(emailId);
    if (!parent) throw new NotFoundError(`Email ${emailId} not found`);

    if (!parent.addressId) {
      throw new ConflictError(
        'That message is not attached to a managed address, so there is nothing to reply as',
      );
    }

    const from = await this.requireSendableAddress(parent.addressId);

    // The parent's own id if it has one; otherwise the provider's, which is
    // what the recipient's client saw.
    const parentId = parent.messageId ?? parent.providerMessageId;
    const references = parentId
      ? [...parent.references, parentId].filter(unique)
      : parent.references;

    const to = input.to?.length ? input.to : [parent.from];
    const subject = replySubject(parent.subject);

    const threadId = parent.threadId ?? (await this.threadFor(parent)).id;

    const queued = await this.queue({
      threadId,
      addressId: from.id,
      from: from.email,
      to,
      cc: input.cc ?? [],
      subject,
      text: input.text ?? null,
      html: input.html ?? null,
      inReplyTo: parentId,
      references,
    });

    const sent = await this.dispatch(queued, () =>
      this.provider.reply({
        from: from.email,
        to,
        cc: input.cc,
        subject,
        text: input.text,
        html: input.html,
        inReplyTo: parentId ?? '',
        references,
      }),
    );

    await this.threads.touch(threadId, sent.sentAt ?? new Date());
    return sent;
  }

  /**
   * Records what the provider said about a message after we handed it over.
   *
   * Bounces arrive minutes to days later and name the provider's id, not ours.
   * An event for a message we do not hold is recorded without an email id
   * rather than dropped: it is still the answer to "where did that go?".
   */
  async recordDeliveryEvent(event: {
    type: 'delivered' | 'soft_bounced' | 'hard_bounced' | 'failed';
    providerMessageId: string | null;
    messageId: string | null;
    recipient: string | null;
    detail: Record<string, unknown>;
  }): Promise<{ emailId: string | null }> {
    const email =
      (event.providerMessageId
        ? await this.emails.findByProviderMessageId(event.providerMessageId)
        : null) ??
      (event.messageId ? await this.emails.findByMessageId(event.messageId) : null);

    if (email) {
      await this.emails.updateStatus(email.id, statusFor(event.type));
    }

    await this.events.create({
      emailId: email?.id ?? null,
      type: `email.${event.type}` as const,
      metadata: {
        recipient: event.recipient,
        providerMessageId: event.providerMessageId,
        messageId: event.messageId,
        ...(email ? {} : { unmatched: true }),
        detail: event.detail,
      },
    });

    return { emailId: email?.id ?? null };
  }

  private async requireSendableAddress(addressId: string) {
    const address = await this.addresses.findByIdWithDomain(addressId);

    if (!address) throw new NotFoundError(`Address ${addressId} not found`);
    if (!address.enabled) {
      throw new ConflictError(`Address ${address.email} is disabled`);
    }

    if (!address.canSend || !address.providerAliasId) {
      throw new ValidationError(
        `Address ${address.email} is inbound-only. Sending needs a concrete provider alias, which a domain catch-all does not give it.`,
      );
    }

    return address;
  }

  private async queue(data: {
    threadId: string;
    addressId: string;
    from: string;
    to: string[];
    cc: string[];
    subject: string;
    text: string | null;
    html: string | null;
    inReplyTo: string | null;
    references: string[];
  }): Promise<Email> {
    if (!data.text && !data.html) {
      throw new ValidationError('A message needs a text or HTML body');
    }

    const email = await this.emails.create({
      ...data,
      providerMessageId: null,
      messageId: null,
      // Inbound dedupe only; there is no provider delivery to replay here.
      fingerprint: null,
      direction: 'outbound',
      status: 'queued',
      rawStorageKey: null,
      receivedAt: null,
      sentAt: null,
    });

    await this.events.create({
      emailId: email.id,
      type: 'email.queued',
      metadata: { to: data.to, cc: data.cc, subject: data.subject },
    });

    return email;
  }

  private async dispatch(
    queued: Email,
    call: () => Promise<{
      providerMessageId: string | null;
      messageId: string | null;
      acceptedAt: Date;
    }>,
  ): Promise<Email> {
    try {
      const result = await call();

      const sent = await this.emails.recordSent(queued.id, {
        status: 'sent',
        providerMessageId: result.providerMessageId,
        messageId: result.messageId,
        sentAt: result.acceptedAt,
      });

      await this.events.create({
        emailId: sent.id,
        type: 'email.sent',
        metadata: {
          providerMessageId: result.providerMessageId,
          messageId: result.messageId,
        },
      });

      return sent;
    } catch (error) {
      // The row stays, marked `failed`: an operator needs to see the attempt,
      // and a silently discarded send is the one failure mode with no trace.
      await this.emails.updateStatus(queued.id, 'failed');
      await this.events.create({
        emailId: queued.id,
        type: 'email.failed',
        metadata: { error: (error as Error).message },
      });

      throw error;
    }
  }

  /** Only reachable for a message written before threads existed. */
  private async threadFor(parent: Email) {
    return this.threads.create({
      subject: parent.subject,
      lastMessageAt: parent.receivedAt ?? parent.createdAt,
    });
  }
}

function statusFor(type: string): Email['status'] {
  switch (type) {
    case 'delivered':
      return 'delivered';
    case 'soft_bounced':
      return 'soft_bounced';
    case 'hard_bounced':
      return 'hard_bounced';
    default:
      return 'failed';
  }
}

/** One `Re:` is threading; three is a mail client that cannot count. */
function replySubject(subject: string | null): string {
  const base = subject?.trim() || '(no subject)';
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

function unique<T>(value: T, index: number, all: T[]): boolean {
  return all.indexOf(value) === index;
}
