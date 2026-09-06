import 'server-only';

import { relayAddressFor } from '@/server/core/config';
import { randomToken, sha256Hex } from '@/server/core/crypto';
import type { AddressWithDomain, Email } from '@/server/core/types';
import type { MailProvider } from '@/server/providers/types';
import type {
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
  ) {}

  async forward(input: {
    email: Email;
    address: AddressWithDomain;
  }): Promise<{ delivered: number; failed: number }> {
    const targets = await this.targetsFor(input.address.id);
    let delivered = 0;
    let failed = 0;

    for (const target of targets) {
      try {
        await this.notify(target, input);
        delivered += 1;
      } catch (error) {
        failed += 1;
        await this.events.create({
          emailId: input.email.id,
          type: 'personal_forward.failed',
          metadata: {
            endpointId: target.endpointId,
            recipientId: target.recipientId,
            error: (error as Error).message,
          },
        });
      }
    }

    return { delivered, failed };
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
  ): Promise<void> {
    await this.events.create({
      emailId: email.id,
      type: 'personal_forward.queued',
      metadata: { endpointId: target.endpointId, recipientId: target.recipientId },
    });

    const replyTo = email.threadId
      ? await this.mintRelayAddress({
          addressId: address.id,
          threadId: email.threadId,
          recipientId: target.recipientId,
        })
      : null;

    await this.provider.send({
      // The managed address does the sending; the customer's name survives as
      // a display name so the notification reads like the original.
      from: `${quoteDisplayName(`${displayNameOf(email.from)} via ${address.email}`)} <${address.email}>`,
      to: [target.email],
      ...(replyTo ? { replyTo } : {}),
      subject: email.subject ?? '(no subject)',
      text: notificationBody(email, replyTo),
      ...(email.html ? { html: email.html } : {}),
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
        hasRelay: Boolean(replyTo),
      },
    });
  }

  private async mintRelayAddress(input: {
    addressId: string;
    threadId: string;
    recipientId: string;
  }): Promise<string | null> {
    const token = randomToken(24);
    const relayAddress = relayAddressFor(token);

    // No relay domain configured: send the notification anyway, without a
    // Reply-To. A reply then lands on the managed address as ordinary inbound
    // mail — visible, and never forwarded on to the customer by accident.
    if (!relayAddress) return null;

    await this.relays.create({
      tokenHash: sha256Hex(token),
      addressId: input.addressId,
      threadId: input.threadId,
      endpointEmailRecipientId: input.recipientId,
      expiresAt: new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000),
    });

    return relayAddress;
  }
}

function notificationBody(email: Email, replyTo: string | null): string {
  const header = [
    `From: ${email.from}`,
    `To: ${email.to.join(', ')}`,
    email.cc.length > 0 ? `Cc: ${email.cc.join(', ')}` : null,
    replyTo
      ? 'Reply to this message and MailPiston sends it to the customer as the managed address.'
      : 'No reply relay is configured, so replying here will not reach the customer.',
  ]
    .filter(Boolean)
    .join('\n');

  return `${header}\n\n---\n\n${email.text ?? '(no plain-text body)'}`;
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
