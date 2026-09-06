import 'server-only';

import { sha256Hex, timingSafeEqual } from '@/server/core/crypto';
import type { Email } from '@/server/core/types';
import type { NormalizedInboundEmail } from '@/server/providers/types';
import type {
  EmailRepository,
  EndpointRepository,
  EventRepository,
  ReplyRelayRepository,
} from '@/server/repositories/types';

import type { OutboundService } from '../emails/outbound-service';

/**
 * Replies arriving from a verified personal inbox (plan §19.2).
 *
 * A message to `reply+<token>@<relay domain>` is not customer mail and is not
 * stored as inbound: it is an instruction to send a customer-facing reply as
 * the managed address. Everything here exists to make sure that instruction is
 * genuine and that nothing personal travels with it.
 *
 * The checks, in order, and why each one is not optional:
 *
 *  - **the token resolves** — looked up by hash, so the stored value is useless
 *    to anyone who reads the table;
 *  - **it is neither revoked nor expired** — a relay address is public from the
 *    moment it lands in a mailbox, and an unbounded one is a permanent hole;
 *  - **the envelope sender is the verified recipient it was minted for** —
 *    without this, anyone who learns a relay address can send mail as the
 *    managed address to that customer;
 *  - **it is not an auto-reply** — an out-of-office answering a notification
 *    would otherwise be relayed to the customer, and their auto-reply back to
 *    us would close the loop.
 *
 * A rejection sends nothing, records why, and still answers the provider 200:
 * the delivery was handled, and retrying it would not change the outcome.
 *
 * The reply itself is *reconstructed*, never re-transmitted. Only the new text
 * is taken; the personal `Message-ID`, `Return-Path`, `Received` chain, and
 * authentication headers are left behind with the original.
 */
export interface RelayResult {
  status: 'relayed' | 'rejected';
  emailId: string | null;
  reason?: string;
}

export class RelayService {
  constructor(
    private readonly relays: ReplyRelayRepository,
    private readonly endpoints: EndpointRepository,
    private readonly emails: EmailRepository,
    private readonly events: EventRepository,
    private readonly outbound: OutboundService,
  ) {}

  async handle(normalized: NormalizedInboundEmail): Promise<RelayResult> {
    const token = tokenFrom(normalized.recipient);
    if (!token) return this.reject(normalized, 'malformed_relay_address');

    const relay = await this.relays.findByTokenHash(sha256Hex(token));
    if (!relay) return this.reject(normalized, 'unknown_token');

    if (relay.revokedAt) return this.reject(normalized, 'revoked_token');
    if (relay.expiresAt && relay.expiresAt.getTime() < Date.now()) {
      return this.reject(normalized, 'expired_token');
    }

    const recipient = await this.endpoints.findRecipient(
      relay.endpointEmailRecipientId,
    );

    if (!recipient?.verifiedAt || !recipient.enabled) {
      return this.reject(normalized, 'recipient_not_verified');
    }

    const sender = (normalized.envelopeSender ?? normalized.from).toLowerCase();
    if (!timingSafeEqual(addressOnly(sender), recipient.email.toLowerCase())) {
      // The one check an attacker who learns a relay address has to beat.
      return this.reject(normalized, 'sender_mismatch');
    }

    if (isAutoResponse(normalized)) {
      return this.reject(normalized, 'auto_response');
    }

    const parent = await this.newestCustomerMessage(relay.threadId);
    if (!parent) return this.reject(normalized, 'no_customer_message');

    await this.events.create({
      emailId: parent.id,
      type: 'relay.reply_received',
      metadata: { relayId: relay.id, recipientId: recipient.id },
    });

    // `reply` owns the threading headers, the `From:`, and the persistence, so
    // a relayed reply and a dashboard reply are the same customer-facing thing.
    const sent = await this.outbound.reply(parent.id, {
      text: stripQuotedReply(normalized.text ?? ''),
    });

    await this.events.create({
      emailId: sent.id,
      type: 'relay.reply_sent',
      metadata: {
        relayId: relay.id,
        threadId: relay.threadId,
        // Deliberately no personal address, and no token: this event is
        // readable wherever events are, including future endpoint payloads.
        recipientId: recipient.id,
      },
    });

    return { status: 'relayed', emailId: sent.id };
  }

  /** Who the reply is actually going to: the last message the customer sent. */
  private async newestCustomerMessage(threadId: string): Promise<Email | null> {
    const { items } = await this.emails.list({
      threadId,
      direction: 'inbound',
      limit: 1,
    });

    return items[0] ?? null;
  }

  private async reject(
    normalized: NormalizedInboundEmail,
    reason: string,
  ): Promise<RelayResult> {
    await this.events.create({
      emailId: null,
      type: 'relay.reply_rejected',
      metadata: {
        reason,
        // The recipient carries the token, so it is recorded as its hash.
        relayTokenHash: sha256Hex(tokenFrom(normalized.recipient) ?? ''),
        envelopeSender: normalized.envelopeSender,
        from: normalized.from,
        subject: normalized.subject,
      },
    });

    return { status: 'rejected', emailId: null, reason };
  }
}

/** `reply+<token>@relay.example` → `<token>`. */
function tokenFrom(recipient: string): string | null {
  const localPart = recipient.split('@')[0] ?? '';
  const [prefix, ...rest] = localPart.split('+');

  if (prefix.toLowerCase() !== 'reply' || rest.length === 0) return null;
  return rest.join('+') || null;
}

function addressOnly(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

/**
 * Out-of-office and vacation mail, which must never be relayed onward.
 *
 * `Auto-Submitted` is the standard signal (RFC 3834); the Microsoft and
 * precedence headers are what everything else actually sends.
 */
function isAutoResponse(normalized: NormalizedInboundEmail): boolean {
  const headers = Object.fromEntries(
    Object.entries(normalized.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      String(value).toLowerCase(),
    ]),
  );

  const autoSubmitted = headers['auto-submitted'];
  if (autoSubmitted && autoSubmitted !== 'no') return true;

  if (headers['x-autoreply'] || headers['x-autorespond']) return true;
  if (headers['x-auto-response-suppress']) return true;
  return ['auto_reply', 'bulk', 'junk'].includes(headers.precedence ?? '');
}

/**
 * Best-effort removal of the quoted original and signature.
 *
 * Best-effort is the honest description: mail clients quote in a dozen ways and
 * an operator can always paste something personal into the body themselves.
 * This strips what is mechanical — the `>` block, the attribution line above
 * it, and anything after the `-- ` signature marker — and claims nothing more.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trimEnd() === '--') break;
    if (line.trimEnd() === '-- ') break;

    // "On <date>, <someone> wrote:" — optionally wrapped onto the next line.
    if (/^\s*(on\b.*\bwrote:|-{2,}\s*original message\s*-{2,})\s*$/i.test(line)) {
      break;
    }

    if (/^\s*on\b.*,\s*$/i.test(line) && /wrote:/i.test(lines[index + 1] ?? '')) {
      break;
    }

    if (/^\s*>/.test(line)) break;

    kept.push(line);
  }

  return kept.join('\n').trim() || text.trim();
}
