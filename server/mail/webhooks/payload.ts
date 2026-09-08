import 'server-only';

import { attachmentDownloadUrl } from '@/server/core/config';
import type {
  Email,
  EmailAttachment,
  EmailStatus,
  MailEvent,
} from '@/server/core/types';
import type {
  MailpistonAddress,
  MailpistonDeliveryState,
  MailpistonEmail,
  MailpistonEventType,
  MailpistonWebhookEvent,
} from '@/sdk/src/payload';

/**
 * Builds the public v1 payload (plan §13, roadmap §5.7).
 *
 * The types come from `sdk/`, not from a server-side copy: the SDK is what
 * receivers compile against, so a field that exists only here would be a
 * contract nobody can consume.
 *
 * This is the seam where internal vocabulary is translated rather than
 * exported. `EmailStatus`, provider ids, storage keys, fingerprints, and raw
 * MIME all stop here. Anything that crosses becomes something we owe
 * compatibility on.
 */

/** Which internal event types are deliverable to a webhook endpoint. */
const DELIVERABLE: Partial<Record<MailEvent['type'], MailpistonEventType>> = {
  'email.received': 'email.received',
};

export function webhookEventTypeFor(
  type: MailEvent['type'],
): MailpistonEventType | null {
  return DELIVERABLE[type] ?? null;
}

/**
 * Internal status → the state a receiving application sees.
 *
 * The two bounce classes collapse into one: soft and hard is *our* retry
 * decision, and an application that wants to react to a bounce reacts the same
 * way to both.
 */
const STATE: Record<EmailStatus, MailpistonDeliveryState> = {
  received: 'received',
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  soft_bounced: 'bounced',
  hard_bounced: 'bounced',
  failed: 'failed',
};

export interface BuildPayloadInput {
  event: MailEvent;
  email: Email;
  attachments: EmailAttachment[];
  type: MailpistonEventType;
}

export function buildWebhookPayload({
  event,
  email,
  attachments,
  type,
}: BuildPayloadInput): MailpistonWebhookEvent {
  const metadata = event.metadata as {
    envelopeSender?: string | null;
    envelopeRecipients?: string[];
    recipient?: string;
  };

  const data: MailpistonEmail = {
    id: email.id,
    threadId: email.threadId,
    direction: email.direction,
    state: STATE[email.status],

    // The envelope is carried separately from the headers because they
    // disagree on exactly the deliveries that matter: a BCC arrives with a
    // `To:` naming somebody else, and routing followed the envelope.
    envelope: {
      from: metadata.envelopeSender ?? null,
      recipients:
        metadata.envelopeRecipients ??
        (metadata.recipient ? [metadata.recipient] : []),
    },

    from: parseAddress(email.from),
    to: email.to,
    cc: email.cc,

    subject: email.subject,
    text: email.text,
    html: email.html,

    inReplyTo: email.inReplyTo,
    references: email.references,

    receivedAt: email.receivedAt?.toISOString() ?? null,

    // Metadata and a URL, never bytes: a 20 MB payload would be refused by
    // half the receivers on the internet, and the ones that accepted it would
    // hold it in memory to check a signature.
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      downloadUrl: attachmentDownloadUrl(attachment.id),
    })),
  };

  return {
    version: '1',
    // The event id, not the delivery id. It is stable across every retry, so a
    // receiver can key its own idempotency off it; the delivery id travels in
    // a header for correlating one specific attempt.
    id: event.id,
    type,
    createdAt: event.occurredAt.toISOString(),
    data,
  };
}

/** `"Ada Lovelace" <ada@example.com>` → `{ name, email }`; a bare address → `{ null, email }`. */
function parseAddress(value: string): MailpistonAddress {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);

  if (!match) return { name: null, email: value.trim() };

  const name = match[1].replace(/^"|"$/g, '').trim();
  return { name: name || null, email: match[2].trim() };
}
