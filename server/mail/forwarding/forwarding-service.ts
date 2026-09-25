import 'server-only';

import { randomToken, sha256Hex } from '@/server/core/crypto';
import { mapWithConcurrency } from '@/server/core/concurrency';
import { ConflictError, ValidationError } from '@/server/core/errors';
import type { AddressWithDomain, Email } from '@/server/core/types';
import type { EgressBudget } from '@/server/mail/emails/egress-budget';
import type { MailProvider } from '@/server/providers/types';
import type {
  DomainRepository,
  EndpointRepository,
  EventRepository,
  ReplyRelayRepository,
} from '@/server/repositories/types';

/**
 * Personal-inbox forwarding (plan §19).
 *
 * The operator should not have to live in the dashboard, so a verified personal
 * mailbox can be the human interface while MailPiston stays the only public
 * mail identity. Three rules make that safe, and all three are easy to get
 * wrong:
 *
 * **A constructed notification, never a redirect.** Re-sending the customer's
 * raw MIME to a personal address would carry their `Message-ID`, `Received`
 * chain, and authentication results into a mailbox that has nothing to do with
 * the managed domain — and a reply to it would go straight from the operator's
 * personal address to the customer. We build a fresh message instead.
 *
 * **The `Reply-To` is an opaque relay address**, so the reply comes back
 * through MailPiston and leaves as the managed address. Only the hash of the
 * token is stored: the relay address is public the moment it is delivered, and
 * a leaked table must not hand anyone a usable one.
 *
 * **A forwarding failure never fails ingress.** The message is already durable
 * by the time this runs. Rejecting the provider's POST because a personal
 * mailbox was unreachable would make the provider retry a delivery we already
 * hold, and the retry would deduplicate — the operator would simply never see
 * the mail.
 *
 * Notifications are internal deliveries, not customer-facing mail: they get
 * their own `personal_forward.*` events and are deliberately not persisted as
 * outbound messages in the thread. They do still cost a provider send, which is
 * why they are counted separately rather than not at all.
 */
export interface ForwardTarget {
  endpointId: string;
  recipientId: string;
  email: string;
}

export class ForwardingService {
  constructor(
    private readonly endpoints: EndpointRepository,
    private readonly relays: ReplyRelayRepository,
    private readonly events: EventRepository,
    private readonly provider: MailProvider,
    private readonly ttlDays: number,
    private readonly domains: DomainRepository,
    private readonly egressBudget: EgressBudget = {
      async reserve() {},
    },
  ) {}

  async forward(input: {
    email: Email;
    address: AddressWithDomain;
  }): Promise<{ delivered: number; failed: number }> {
    const targets = await this.targetsFor(input.address.id);
    if (targets.length === 0) return { delivered: 0, failed: 0 };

    const relayDomain = await this.domains.findRelayDomain();
    const outcomes = await mapWithConcurrency(targets, 5, async (target) => {
      try {
        await this.notify(target, input, relayDomain?.name ?? null);
        return true;
      } catch (error) {
        await this.events.create({
          emailId: input.email.id,
          type: 'personal_forward.failed',
          metadata: {
            endpointId: target.endpointId,
            recipientId: target.recipientId,
            error: (error as Error).message,
          },
        });
        return false;
      }
    });

    const delivered = outcomes.filter(Boolean).length;
    return { delivered, failed: outcomes.length - delivered };
  }

  /** Verified, enabled recipients of every enabled email endpoint on the address. */
  private async targetsFor(addressId: string): Promise<ForwardTarget[]> {
    const endpoints = await this.endpoints.listForAddress(addressId);
    const targets: ForwardTarget[] = [];

    for (const endpoint of endpoints) {
      if (endpoint.type === 'webhook') continue;

      const recipients = await this.endpoints.listRecipients(endpoint.id);

      for (const recipient of recipients) {
        // Unverified recipients are silently skipped rather than attempted:
        // an unproven address is exactly the case forwarding must not reach.
        if (!recipient.verifiedAt || !recipient.enabled) continue;

        targets.push({
          endpointId: endpoint.id,
          recipientId: recipient.id,
          email: recipient.email,
        });
      }
    }

    return targets;
  }

  private async notify(
    target: ForwardTarget,
    { email, address }: { email: Email; address: AddressWithDomain },
    relayDomain: string | null,
  ): Promise<void> {
    await this.assertExternalTarget(target.email);

    if (!relayDomain) {
      throw new ConflictError(
        'Personal forwarding is disabled until a verified reply-relay domain is selected on the Domains page.',
      );
    }
    if (!email.threadId) {
      throw new ConflictError('Personal forwarding needs a thread for safe reply routing');
    }

    await this.egressBudget.reserve({
      kind: 'personal_forward',
      recipient: target.email,
    });

    await this.events.create({
      emailId: email.id,
      type: 'personal_forward.queued',
      metadata: { endpointId: target.endpointId, recipientId: target.recipientId },
    });

    const replyTo = await this.mintRelayAddress({
      addressId: address.id,
      threadId: email.threadId,
      recipientId: target.recipientId,
      relayDomain,
    });

    await this.provider.send({
      // The managed address does the sending; the customer's name survives as
      // a display name so the notification reads like the original.
      from: `${quoteDisplayName(`${displayNameOf(email.from)} via ${address.email}`)} <${address.email}>`,
      to: [target.email],
      replyTo,
      subject: email.subject ?? '(no subject)',
      text: notificationBody(email, address.email),
      ...(email.html
        ? { html: notificationHtml(email, address.email) }
        : {}),
      headers: {
        // Loop prevention: our own ingress drops anything wearing these, and
        // well-behaved autoresponders stay quiet for `auto-generated`.
        'Auto-Submitted': 'auto-generated',
        'X-Mailpiston-Forward': email.id,
      },
    });

    await this.events.create({
      emailId: email.id,
      type: 'personal_forward.delivered',
      metadata: {
        endpointId: target.endpointId,
        recipientId: target.recipientId,
        hasRelay: true,
      },
    });
  }

  private async mintRelayAddress(input: {
    addressId: string;
    threadId: string;
    recipientId: string;
    relayDomain: string;
  }): Promise<string> {
    const token = randomToken(24);
    const relayAddress = `reply+${token}@${input.relayDomain}`;

    await this.relays.create({
      tokenHash: sha256Hex(token),
      relayDomain: input.relayDomain,
      addressId: input.addressId,
      threadId: input.threadId,
      endpointEmailRecipientId: input.recipientId,
      expiresAt: new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000),
    });

    return relayAddress;
  }

  private async assertExternalTarget(email: string): Promise<void> {
    const domainName = recipientDomain(email);
    if (!domainName) throw new ValidationError('Forward target is not a valid email address');

    if (await this.domains.findByName(domainName)) {
      throw new ConflictError(
        `Refusing to forward to ${email}: it belongs to a domain managed by this MailPiston workspace.`,
      );
    }
  }
}

function recipientDomain(email: string): string | null {
  const separator = email.lastIndexOf('@');
  return separator > 0 ? email.slice(separator + 1).trim().toLowerCase() : null;
}

function notificationBody(email: Email, managedAddress: string): string {
  const header = [
    'MailPiston delivery',
    `Original sender: ${email.from}`,
    `Received by MailPiston at: ${managedAddress}`,
    'Reply to this message and MailPiston sends it to the customer as the managed address.',
  ]
    .join('\n');

  return `${header}\n\n---\n\n${email.text ?? '(no plain-text body)'}`;
}

/**
 * HTML messages previously hid the explanatory text-part entirely in most mail
 * clients, making the managed address in `From` and the relay-domain
 * `Reply-To` look like an accidental loop. Keep the original HTML intact, but
 * put an escaped routing explanation in the visible HTML alternative too.
 */
function notificationHtml(email: Email, managedAddress: string): string {
  const sender = escapeHtml(email.from);
  const receivedAt = escapeHtml(managedAddress);

  return [
    '<div style="border:1px solid #d4d4d4;padding:12px;margin:0 0 16px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">',
    '<strong>MailPiston delivery</strong><br>',
    `Original sender: ${sender}<br>`,
    `Received by MailPiston at: ${receivedAt}<br>`,
    'Reply to this message and MailPiston will send your response to the customer as the managed address.',
    '</div>',
    email.html ?? '',
  ].join('');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

/** `"Ada Lovelace" <ada@example.com>` → `Ada Lovelace`; a bare address → itself. */
function displayNameOf(from: string): string {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
  const name = match?.[1]?.trim();
  return name || from.replace(/[<>]/g, '').trim();
}

/** Quotes a display name so a comma or quote in a customer's name cannot restructure the header. */
function quoteDisplayName(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
